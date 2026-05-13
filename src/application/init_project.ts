import type { FsWriter, GitAdapter, Harness, LockStore } from "./ports.ts";
import { sha256Hex } from "../domain/sha256.ts";
import type {
  BacklogBackend,
  InstalledLock,
  KnownHarness,
  LockEntry,
  VersionScheme,
} from "../domain/installed_lock.ts";
import type { CoreBundle } from "../domain/core_bundle.ts";
import { TEMPLATES_VERSION } from "../templates_bundle.ts";
import { canonicalBlockBody } from "../domain/merge_block.ts";

export type InitResult =
  | {
    status: "initialized";
    /** Count of non-mergeable files written. Matches the collision-guard count. */
    filesWritten: number;
    /** Paths of mergeable files (e.g. .gitignore) merged into pre-existing user content. */
    filesMerged: string[];
    warnings: string[];
    backups: string[];
    lockWritten: boolean;
  }
  | {
    status: "conflicts";
    conflicts: string[];
    /**
     * True when a `.specflow/installed.lock` already exists at the target —
     * lets the CLI suggest `specflow upgrade` instead of `--force` for
     * projects that were previously initialised by Specflow.
     */
    lockExists: boolean;
  };

export type InitProjectDeps = {
  writer: FsWriter;
  git: GitAdapter;
  lockStore: LockStore;
  harness: Harness;
  backlogBackend: BacklogBackend;
  versionScheme: VersionScheme;
  core: CoreBundle;
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
    const {
      writer,
      git,
      lockStore,
      harness,
      backlogBackend,
      versionScheme,
      core,
      ensureDir,
    } = this.deps;
    const warnings: string[] = [];

    await ensureDir(input.targetDir);

    const bundle = harness.mapBundle(core, { backlogBackend, versionScheme });

    if (!input.force) {
      const conflicts = await writer.detectConflicts(bundle, input.targetDir);
      if (conflicts.length > 0) {
        const existingLock = await lockStore.read(input.targetDir);
        return {
          status: "conflicts",
          conflicts,
          lockExists: existingLock !== null,
        };
      }
    }

    const report = await writer.writeBundle(bundle, input.targetDir, {
      overwrite: input.force,
      backupExisting: input.force,
    });

    const now = (this.deps.now ?? (() => new Date()))().toISOString();
    // Skip-if-exists files that pre-existed are user-owned, not
    // Specflow-managed — keep them out of the lock so future upgrades
    // don't try to reconcile them against the placeholder content.
    const skippedSet = new Set(report.skippedSkipIfExists);
    const lockEntries = new Map<string, LockEntry>();
    for (const [dest, file] of Object.entries(bundle)) {
      if (skippedSet.has(dest)) continue;
      // JSON-merged files (#139) live entirely in user-owned space — the
      // user's settings.json may diverge from our bundled snapshot in
      // arbitrary ways (theme, permissions, env, …) and that's fine.
      // We never overwrite or upgrade them, so they don't belong in the
      // lock. Same logic as skipIfExists.
      if (file.mergeJson !== undefined) continue;
      // For mergeable files the lock holds the SHA of the *block body in
      // canonical form* (no leading/trailing newlines) so it stays
      // comparable against the body extracted from disk on upgrade reads.
      const shaInput = file.mergeBlock !== undefined
        ? canonicalBlockBody(file.content)
        : file.content;
      lockEntries.set(dest, {
        sha256: await sha256Hex(shaInput),
        installedAt: now,
        templatesVersion: TEMPLATES_VERSION,
      });
    }
    const lock: InstalledLock = {
      version: 2,
      harness: harness.key as KnownHarness,
      backlogBackend,
      versionScheme,
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

    const mergedPaths: string[] = [];
    let writtenCount = 0;
    for (const [dest, file] of Object.entries(bundle)) {
      if (file.mergeBlock !== undefined || file.mergeJson !== undefined) {
        mergedPaths.push(dest);
      } else {
        writtenCount++;
      }
    }

    return {
      status: "initialized",
      filesWritten: writtenCount,
      filesMerged: mergedPaths,
      warnings,
      backups: report.backups.map((b) => b.dest),
      lockWritten: true,
    };
  }
}
