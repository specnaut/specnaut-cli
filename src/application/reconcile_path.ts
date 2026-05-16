import type { FsReader, FsWriter, LockStore, StagingStore } from "./ports.ts";
import type { InstalledLock } from "../domain/installed_lock.ts";
import { computeAcceptCurrent, computeAcceptUpstream } from "../domain/reconcile.ts";

export type ReconcileMode = "accept-upstream" | "accept-current";

export type ReconcilePathInput = {
  readonly projectDir: string;
  readonly path: string;
  readonly mode: ReconcileMode;
  readonly now?: () => Date;
};

export type ReconcilePathResult =
  | { status: "ok" }
  | { status: "no-marker" }
  | { status: "no-staging" }
  | { status: "no-lock-entry" }
  | { status: "no-project-file" };

export type ReconcilePathDeps = {
  reader: FsReader;
  writer: FsWriter;
  lockStore: LockStore;
  stagingStore: StagingStore;
};

export class ReconcilePathUseCase {
  constructor(private readonly deps: ReconcilePathDeps) {}

  async execute(input: ReconcilePathInput): Promise<ReconcilePathResult> {
    const { reader, writer, lockStore, stagingStore } = this.deps;

    const lock = await lockStore.read(input.projectDir);
    if (lock === null) return { status: "no-marker" };

    const lockEntry = lock.entries.get(input.path);
    if (!lockEntry) return { status: "no-lock-entry" };

    const stagingContent = await stagingStore.read(input.projectDir, input.path);
    if (stagingContent === null) return { status: "no-staging" };

    const onDiskContent = await reader.readText(input.projectDir, input.path);
    if (onDiskContent === null) return { status: "no-project-file" };

    const now = (input.now ?? (() => new Date()))();

    const recomputed = input.mode === "accept-upstream"
      ? await computeAcceptUpstream({
        path: input.path,
        onDiskContent,
        stagingContent,
        templatesVersion: lock.templatesVersion,
        now,
      })
      : await computeAcceptCurrent({
        path: input.path,
        onDiskContent,
        stagingContent,
        templatesVersion: lock.templatesVersion,
        now,
      });

    // Backup + write to project path (only on accept-upstream).
    const toWrite: Record<string, { content: string; executable: boolean }> = {};
    if (recomputed.backupFromContent !== null) {
      toWrite[`${input.path}.specflow.bak`] = {
        content: recomputed.backupFromContent,
        executable: false,
      };
    }
    if (recomputed.projectWrite !== null) {
      toWrite[input.path] = { content: recomputed.projectWrite, executable: false };
    }
    if (Object.keys(toWrite).length > 0) {
      await writer.writeBundle(toWrite, input.projectDir, {
        overwrite: true,
        backupExisting: false,
      });
    }

    // Update lock entry.
    const updatedEntries = new Map(lock.entries);
    updatedEntries.set(input.path, recomputed.newLockEntry);
    const updatedLock: InstalledLock = { ...lock, entries: updatedEntries };
    await lockStore.write(input.projectDir, updatedLock);

    // Remove the staging entry.
    await stagingStore.delete(input.projectDir, input.path);
    await stagingStore.cleanupIfEmpty(input.projectDir);

    return { status: "ok" };
  }
}
