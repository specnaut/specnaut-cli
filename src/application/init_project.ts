import type {
  ContextLinkWrite,
  FsReader,
  FsWriter,
  GitAdapter,
  Harness,
  LockStore,
} from "./ports.ts";
import { sha256Hex } from "../domain/sha256.ts";
import type {
  BacklogBackend,
  InstalledLock,
  KnownHarness,
  LockEntry,
  SpecBackend,
  VersionScheme,
} from "../domain/installed_lock.ts";
import { RemovedHarnessError } from "../domain/installed_lock.ts";
import type { CoreBundle } from "../domain/core_bundle.ts";
import { type Bundle, lockShaInput } from "../domain/template.ts";
import { TEMPLATES_VERSION } from "../templates_bundle.ts";
import { filterInitBundle } from "./init_bundle_filter.ts";
import { isAgenticPath } from "../domain/parent_managed.ts";

export type InitResult =
  | {
    status: "initialized";
    /** Count of non-mergeable files written. Matches the collision-guard count. */
    filesWritten: number;
    /** Those files' dests — what the hook-trust check reads (`hook_trust.ts`). */
    written: string[];
    /** Paths of mergeable files (e.g. .gitignore) merged into pre-existing user content. */
    filesMerged: string[];
    warnings: string[];
    backups: string[];
    /** Backups that moved a SYMLINK rather than content (cli#574). */
    linksMoved: string[];
    /** The context links written, and in which form (cli#680). */
    contextLinks: ReadonlyArray<ContextLinkWrite>;
    /** What a JSON merge did that the person should hear about (#642). */
    notes: ReadonlyArray<string>;
    /** JSON-merged dests this run changed — the flavor's verdict, via the writer. */
    mergedChanged: ReadonlyArray<string>;
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
     * lets the CLI suggest `specnaut upgrade` instead of `--force` for
     * projects that were previously initialised by Specnaut.
     */
    lockExists: boolean;
  };

export type InitProjectDeps = {
  writer: FsWriter;
  /**
   * Optional, and only used to evaluate a file's `mergeRefuseIf` guard against
   * what is already on disk (cli#599).
   *
   * Optional rather than required because a greenfield `init` has nothing to
   * read and every existing caller would otherwise need a reader to construct
   * the use case. Absent ⇒ no guard is evaluated, which is the pre-existing
   * behaviour: this can only ever REFUSE a write, never cause one.
   */
  reader?: FsReader;
  git: GitAdapter;
  lockStore: LockStore;
  harness: Harness;
  backlogBackend: BacklogBackend;
  versionScheme: VersionScheme;
  /** Which spec backend to persist + render the phase docs against (spec 020). */
  specBackend: SpecBackend;
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
   * lock-tracked (FR-012) so `specnaut diff` and future upgrades still
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
      specBackend,
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

    const mappedBundle = harness.mapBundle(core, { backlogBackend, versionScheme, specBackend });
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
        // A removed harness's lock is present but un-upgradeable — report it
        // as no lock, so the advice is `--force` rather than `upgrade`.
        const existingLock = await lockStore.read(input.targetDir).catch((err) => {
          if (err instanceof RemovedHarnessError) return null;
          throw err;
        });
        return {
          status: "conflicts",
          conflicts,
          lockExists: existingLock !== null,
        };
      }
    }

    // What is written: preserved and refused dests held back (`init_bundle_filter.ts`).
    const { bundleToWrite, preserved, refusals, excluded } = await filterInitBundle(
      { reader: this.deps.reader, writer, dryRun: input.dryRun },
      input.targetDir,
      bundle,
      input.preservedPaths ?? new Set<string>(),
    );
    warnings.push(...refusals);

    // Dry-run short-circuit: no writes, no lock, no git init. Synthesize
    // an InitResult from `bundleToWrite` (the post-preserve-filter set) so the
    // caller prints the same "would write N files" summary as a real run —
    // excluding the preserved paths it would skip.
    if (input.dryRun) {
      return {
        status: "initialized",
        ...countWrites(bundleToWrite),
        warnings,
        backups: [],
        linksMoved: [],
        contextLinks: [],
        notes: [],
        mergedChanged: [],
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
      if (skippedSet.has(dest) || excluded.has(dest)) continue;
      // JSON-merged files (#139) live in user-owned space: the user's copy may
      // diverge from our snapshot in any way (theme, permissions, env, …). We
      // never overwrite them, so they stay out of the lock, like skipIfExists.
      if (file.mergeJson !== undefined) continue;
      lockEntries.set(dest, {
        sha256: await sha256Hex(lockShaInput(file)),
        installedAt: now,
        templatesVersion: TEMPLATES_VERSION,
      });
    }
    const lock: InstalledLock = {
      version: 2,
      harness: harness.key as KnownHarness,
      backlogBackend,
      versionScheme,
      specBackend,
      templatesVersion: TEMPLATES_VERSION,
      entries: lockEntries,
      // Cache the decision so a later upgrade suppresses agentic files
      // deterministically without re-walking the filesystem.
      ...(input.parentManaged ? { parentManaged: true as const } : {}),
    };
    await lockStore.write(input.targetDir, lock);

    // A git that is missing or refuses is a warning: the scaffold is already written.
    if (input.initGit && !(await git.isAvailable())) {
      warnings.push("git not found on PATH — skipping git init");
    } else if (input.initGit && !(await git.isInitialized(input.targetDir))) {
      await git.init(input.targetDir).catch((err) => {
        warnings.push(`git init failed — ${err instanceof Error ? err.message : String(err)}`);
      });
    }

    // Count from `bundleToWrite` (the post-preserve-filter set), NOT the full
    // `bundle`: preserved paths were skipped on disk, so "wrote N files" must
    // not count files this run never touched (spec 011 / issue #367).
    return {
      status: "initialized",
      ...countWrites(bundleToWrite),
      warnings,
      backups: report.backups.filter((b) => b.wasSymlink !== true).map((b) => b.dest),
      linksMoved: report.backups.filter((b) => b.wasSymlink === true).map((b) => b.dest),
      contextLinks: report.links ?? [],
      notes: report.notes ?? [],
      mergedChanged: report.mergedChanged ?? [],
      lockWritten: true,
      preserved,
    };
  }
}

/**
 * What "wrote N files (+ merged: …)" counts: a merge into a user-owned file is
 * listed by name, every other entry is one file written. Shared by the real run
 * and the dry run, so the preview cannot count differently from the write.
 */
function countWrites(bundle: Bundle) {
  const filesMerged: string[] = [];
  const written: string[] = [];
  for (const [dest, file] of Object.entries(bundle)) {
    if (file.mergeBlock !== undefined || file.mergeJson !== undefined) filesMerged.push(dest);
    else written.push(dest);
  }
  return { filesWritten: written.length, written, filesMerged };
}
