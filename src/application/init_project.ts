import type { Bundle } from "../domain/template.ts";
import type { FsWriter, GitAdapter, LockStore } from "./ports.ts";
import { sha256Hex } from "../domain/sha256.ts";
import type { InstalledLock, LockEntry } from "../domain/installed_lock.ts";
import { TEMPLATES_VERSION } from "../templates_bundle.ts";

export type InitResult =
  | {
    status: "initialized";
    filesWritten: number;
    warnings: string[];
    backups: string[];
    lockWritten: boolean;
  }
  | { status: "conflicts"; conflicts: string[] };

export type InitProjectDeps = {
  writer: FsWriter;
  git: GitAdapter;
  lockStore: LockStore;
  bundle: Bundle;
  /** Creates the target directory if it does not exist (idempotent). */
  ensureDir(path: string): Promise<void>;
  now?: () => Date; // test seam
};

export type InitProjectInput = {
  targetDir: string;
  initGit: boolean;
  force: boolean;
};

export class InitProjectUseCase {
  constructor(private readonly deps: InitProjectDeps) {}

  async execute(input: InitProjectInput): Promise<InitResult> {
    const { writer, git, lockStore, bundle, ensureDir } = this.deps;
    const warnings: string[] = [];

    await ensureDir(input.targetDir);

    if (!input.force) {
      const conflicts = await writer.detectConflicts(bundle, input.targetDir);
      if (conflicts.length > 0) {
        return { status: "conflicts", conflicts };
      }
    }

    const report = await writer.writeBundle(bundle, input.targetDir, {
      overwrite: input.force,
      backupExisting: input.force,
    });

    // Persist the installed lock.
    const now = (this.deps.now ?? (() => new Date()))().toISOString();
    const lockEntries = new Map<string, LockEntry>();
    for (const [dest, file] of Object.entries(bundle)) {
      lockEntries.set(dest, {
        sha256: await sha256Hex(file.content),
        installedAt: now,
        templatesVersion: TEMPLATES_VERSION,
      });
    }
    const lock: InstalledLock = {
      version: 1,
      templatesVersion: TEMPLATES_VERSION,
      entries: lockEntries,
    };
    await lockStore.write(input.targetDir, lock);

    if (input.initGit) {
      const available = await git.isAvailable();
      if (!available) {
        warnings.push("git not found on PATH — skipping git init");
      } else {
        const already = await git.isInitialized(input.targetDir);
        if (!already) {
          try {
            await git.init(input.targetDir);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            warnings.push(`git init failed — ${msg}`);
          }
        }
      }
    }

    return {
      status: "initialized",
      filesWritten: Object.keys(bundle).length,
      warnings,
      backups: report.backups.map((b) => b.dest),
      lockWritten: true,
    };
  }
}
