import type { FsReader, FsWriter, LockStore, StagingStore } from "./ports.ts";
import type { InstalledLock } from "../domain/installed_lock.ts";
import { computeAcceptCurrent, computeAcceptUpstream } from "../domain/reconcile.ts";
import { PathRefusal } from "./path_refusal.ts";
import { leftAlone, tidyStagingRoot } from "./upgrade_staging.ts";
import { terminalText } from "../domain/terminal_text.ts";

export type ReconcileMode = "accept-upstream" | "accept-current";

export type ReconcilePathInput = {
  readonly projectDir: string;
  readonly path: string;
  readonly mode: ReconcileMode;
  readonly now?: () => Date;
};

export type ReconcilePathResult =
  | { status: "ok"; notes: readonly string[] }
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
    const { writer, lockStore, stagingStore } = this.deps;

    const ready = await preflight(
      this.deps,
      await lockStore.read(input.projectDir),
      input.projectDir,
      input.path,
    );
    if (ready.status !== "ok") return ready;
    const { lock, stagingContent, onDiskContent } = ready;

    const compute = input.mode === "accept-upstream" ? computeAcceptUpstream : computeAcceptCurrent;
    const recomputed = await compute({
      path: input.path,
      onDiskContent,
      stagingContent,
      templatesVersion: lock.templatesVersion,
      now: (input.now ?? (() => new Date()))(),
    });

    await writeProjectFile(writer, input, recomputed);

    // Update lock entry.
    const updatedEntries = new Map(lock.entries);
    updatedEntries.set(input.path, recomputed.newLockEntry);
    const updatedLock: InstalledLock = { ...lock, entries: updatedEntries };
    await lockStore.write(input.projectDir, updatedLock);

    // Remove the staging entry. The project file and the lock are committed by
    // now, so a folder that cannot be tidied is a note on an `ok`, never a failure.
    const notes = await stagingStore.delete(input.projectDir, input.path);
    const tidy = await tidyStagingRoot(stagingStore, input.projectDir);
    return { status: "ok", notes: tidy === null ? notes : [...notes, tidy] };
  }
}

/** The backup and the write to the project path; only accept-upstream has either. */
async function writeProjectFile(
  writer: FsWriter,
  input: ReconcilePathInput,
  recomputed: Awaited<ReturnType<typeof computeAcceptUpstream>>,
): Promise<void> {
  const toWrite: Record<string, { content: string; executable: boolean }> = {};
  if (recomputed.backupFromContent !== null) {
    toWrite[`${input.path}.specnaut.bak`] = {
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
}

type Refusal = Exclude<ReconcilePathResult, { status: "ok" }>;

/**
 * Every reason `reconcile <path>` refuses a path, in one place.
 *
 * Two callers need the same answer: `reconcile <path>`, which acts on it, and
 * `reconcile --status`, which promises the path can be acted on. They used to
 * disagree — the listing walked the staging tree and consulted nothing — so
 * `--status` named paths that `reconcile` then refused with "is not tracked by
 * Specnaut", and a queue nobody could empty kept the review marker alive
 * forever (#613). A second spelling of these checks is how they drift apart
 * again, so the listing calls this rather than restating it.
 */
async function preflight(
  deps: Pick<ReconcilePathDeps, "reader" | "stagingStore">,
  lock: InstalledLock | null,
  projectDir: string,
  path: string,
): Promise<
  Refusal | { status: "ok"; lock: InstalledLock; stagingContent: string; onDiskContent: string }
> {
  if (lock === null) return { status: "no-marker" };
  if (!lock.entries.has(path)) return { status: "no-lock-entry" };

  const stagingContent = await deps.stagingStore.read(projectDir, path);
  if (stagingContent === null) return { status: "no-staging" };

  const onDiskContent = await deps.reader.readText(projectDir, path);
  if (onDiskContent === null) return { status: "no-project-file" };

  return { status: "ok", lock, stagingContent, onDiskContent };
}

/** A staged copy the store refused to read, and the words that say why and what to do. */
export type RefusedCopy = { readonly path: string; readonly reason: string };

/** What `reconcile --status` prints: the queue, and the copies no command may act on. */
export type PendingReconciliations = { pending: string[]; refused: RefusedCopy[] };

/**
 * The pending queue behind `reconcile --status`: staged paths that
 * `reconcile <path>` will actually resolve.
 *
 * A staged copy it would refuse is not pending anything — no command can act on
 * it, so listing it only guarantees the review walk never completes. A copy
 * refused by status (untracked, no project file) is hidden here and deleted by
 * the next `upgrade`. A copy the STORE refuses to read — a link, or behind one
 * (cli#765) — is reported in `refused` instead, in `leftAlone`'s words: hiding
 * it would leave a link nobody is told about, and throwing it ended `--status`
 * in a stack trace where the review walk parses JSON. This use case is a read
 * and deletes nothing, so the listing stays safe to run at any time.
 */
export class ListPendingReconciliationsUseCase {
  constructor(
    private readonly deps: Pick<ReconcilePathDeps, "reader" | "lockStore" | "stagingStore">,
  ) {}

  async execute(projectDir: string): Promise<PendingReconciliations> {
    const lock = await this.deps.lockStore.read(projectDir);
    const out: PendingReconciliations = { pending: [], refused: [] };
    for (const path of await this.deps.stagingStore.list(projectDir)) {
      try {
        const ready = await preflight(this.deps, lock, projectDir, path);
        if (ready.status === "ok") out.pending.push(path);
      } catch (err) {
        if (!(err instanceof PathRefusal)) throw err;
        // Shown, never acted on: the walk prints it verbatim, so it is escaped (cli#776).
        const shown = terminalText(path);
        out.refused.push({
          path: shown,
          reason: leftAlone(`.specnaut/upgrade-staging/${path}`, err),
        });
      }
    }
    return out;
  }
}
