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
import type { Bundle } from "../domain/template.ts";
import { TEMPLATES_VERSION } from "../templates_bundle.ts";
import { canonicalBlockBody } from "../domain/merge_block.ts";
import { isAgenticPath } from "../domain/parent_managed.ts";

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
    /**
     * Destination paths skipped from the WRITE set because they were declared
     * preserved (`.specnaut/preserve.yml`, spec 011 / issue #367). Reported so
     * the handler can emit one per-file notice (FR-004). These paths remain
     * lock-tracked (FR-012) — only the write was skipped.
     */
    preserved: ReadonlyArray<string>;
  }
  | {
    status: "conflicts";
    conflicts: string[];
    /**
     * True when a `.specnaut/installed.lock` already exists at the target —
     * lets the CLI suggest `specflow upgrade` instead of `--force` for
     * projects that were previously initialised by Specnaut.
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
  /**
   * When true, compute the plan and return a synthetic "initialized"
   * result without touching disk. Trumps `force`: no overwrites, no
   * backups, no lock written, no git init. Used by `--dry-run`.
   */
  dryRun: boolean;
  /**
   * When true, the target is a member of a providing Specnaut workspace
   * (009-parent-managed-init): the toolkit (`.specnaut/`) is still provisioned
   * but agentic files (`.claude/skills|agents|commands`) are suppressed — they
   * are inherited from the parent. The decision is resolved handler-side via
   * the `ParentWorkspaceReader`; the use case only applies the bundle filter.
   * Absent ⇒ treated as `false` (standalone, full provisioning).
   */
  parentManaged?: boolean;
  /**
   * Destination paths to leave untouched on a forced refresh — the
   * maintainer's preserve declarations (`.specnaut/preserve.yml`, spec 011 /
   * issue #367). These are removed from the WRITE set only; they STAY
   * lock-tracked (FR-012) so `specflow diff` and future upgrades still
   * compare them. Absent/empty ⇒ today's behaviour (FR-011). The handler
   * resolves the set (and validates membership / `--reset-preserved`); the
   * use case never reads the manifest or any CLI flag.
   */
  preservedPaths?: ReadonlySet<string>;
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

    // `--dry-run` skips creating the target dir entirely (no side
    // effects). Everything else below is a no-op for dry-run except
    // the read-only conflict detection.
    if (!input.dryRun) {
      await ensureDir(input.targetDir);
    }

    const mappedBundle = harness.mapBundle(core, { backlogBackend, versionScheme });
    // Parent-managed targets inherit agentic files from the providing
    // workspace: filter them out of the bundle here — after harness mapping,
    // before BOTH writeBundle and lock-entry construction — so suppressed
    // paths are never written and never enter the lock (FR-005 / FR-012).
    const bundle: Bundle = input.parentManaged
      ? Object.fromEntries(
        Object.entries(mappedBundle).filter(([dest]) => !isAgenticPath(dest)),
      )
      : mappedBundle;

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

    // Preserve filter (spec 011 / issue #367): declared paths are removed from
    // the WRITE set so a forced refresh never clobbers them, but they stay in
    // `bundle` for lock-entry construction below — preserved files MUST remain
    // lock-tracked (FR-012). Only dests that are actually in the bundle count
    // as preserved (a declared path outside the bundle is a handler-side warn).
    // Computed before the dry-run short-circuit so the previewed
    // "would write N files" count excludes preserved paths too.
    const preservedSet = input.preservedPaths ?? new Set<string>();
    const preserved: string[] = [];
    const bundleToWrite: Bundle = {};
    for (const [dest, file] of Object.entries(bundle)) {
      if (preservedSet.has(dest)) {
        preserved.push(dest);
        continue;
      }
      bundleToWrite[dest] = file;
    }

    // Dry-run short-circuit: no writes, no lock, no git init. Synthesize
    // an InitResult from `bundleToWrite` (the post-preserve-filter set) so the
    // caller prints the same "would write N files" summary as a real run —
    // excluding the preserved paths it would skip.
    if (input.dryRun) {
      const mergedPaths: string[] = [];
      let writtenCount = 0;
      for (const [dest, file] of Object.entries(bundleToWrite)) {
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
        backups: [],
        lockWritten: false,
        preserved,
      };
    }

    const report = await writer.writeBundle(bundleToWrite, input.targetDir, {
      overwrite: input.force,
      backupExisting: input.force,
    });

    const now = (this.deps.now ?? (() => new Date()))().toISOString();
    // Skip-if-exists files that pre-existed are user-owned, not
    // Specnaut-managed — keep them out of the lock so future upgrades
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
      // Cache the decision so a later upgrade suppresses agentic files
      // deterministically without re-walking the filesystem.
      ...(input.parentManaged ? { parentManaged: true as const } : {}),
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

    // Count from `bundleToWrite` (the post-preserve-filter set), NOT the full
    // `bundle`: preserved paths were skipped on disk, so "wrote N files" must
    // not count files this run never touched (spec 011 / issue #367).
    const mergedPaths: string[] = [];
    let writtenCount = 0;
    for (const [dest, file] of Object.entries(bundleToWrite)) {
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
      preserved,
    };
  }
}
