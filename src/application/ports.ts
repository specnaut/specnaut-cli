import type { Bundle } from "../domain/template.ts";
import type { Release } from "../domain/release.ts";
import type { CheckOutcome } from "../domain/check_result.ts";
import type { InstalledLock, SpecBackend } from "../domain/installed_lock.ts";
import type { CoreBundle } from "../domain/core_bundle.ts";
import type { SpecStep } from "../domain/spec/spec_step.ts";
import type { UpgradeMarker } from "../domain/upgrade_marker.ts";
import type { BundleOptions } from "./bundle_options.ts";
import type { DiskEntry } from "../domain/context_link.ts";
import type { PreserveConfig, PreserveManifestDiagnosis } from "../domain/preserve_config.ts";
import type { HookTrust } from "../domain/hook_trust.ts";

export interface FsWriter {
  detectConflicts(bundle: Bundle, targetDir: string): Promise<string[]>;
  writeBundle(
    bundle: Bundle,
    targetDir: string,
    options: { overwrite?: boolean; backupExisting?: boolean },
  ): Promise<BackupReport>;
  deletePaths(
    paths: ReadonlyArray<string>,
    targetDir: string,
    options: { backupExisting: boolean; within?: (resolvedRel: string) => boolean },
  ): Promise<BackupReport>;
}

export type BackupReport = {
  /**
   * `wasSymlink` marks a backup that moved a LINK rather than file content
   * (cli#574). `Deno.rename` operates on the link, so the user's actual bytes
   * are still at the target and restoring this backup restores a pointer.
   * Reporting it as an ordinary backup told the user their file was saved when
   * what was saved was an arrow — and the moved link lands under
   * `*.specnaut.bak`, which the scaffolded `.gitignore` hides, so the project's
   * deliberate consolidation was dismantled without a trace.
   */
  readonly backups: ReadonlyArray<
    { readonly dest: string; readonly backupPath: string; readonly wasSymlink?: true }
  >;
  /**
   * Dests skipped because the file pre-existed and the entry is `skipIfExists`
   * (the user's content wins). Always present; init leaves them out of the lock.
   */
  readonly skippedSkipIfExists: ReadonlyArray<string>;
  /** Dests `deletePaths` left because their resolved path failed `within` (cli#665). */
  readonly refused?: ReadonlyArray<string>;
  /**
   * What a structured merge changed that the person should hear about — a plugin Specnaut
   * enabled, a marketplace it re-pinned or left pointed elsewhere (#642). Absent when silent.
   */
  readonly notes?: ReadonlyArray<string>;
  /**
   * JSON-merged dests whose content this write changed — the merge flavor's own verdict,
   * so no caller re-diffs the file (plan § 5). Absent when every merge was a no-op.
   */
  readonly mergedChanged?: ReadonlyArray<string>;
  /**
   * Context links this write made (cli#680, cli#681), and in which form: the
   * symlink, or — where the system refused it — the one-line fallback file,
   * with the refusal's reason. Absent when the bundle carried no link, or
   * every link was already in place.
   */
  readonly links?: ReadonlyArray<ContextLinkWrite>;
};

/** One context link a write made. `reason` is set for the fallback form only. */
export type ContextLinkWrite = {
  readonly dest: string;
  readonly target: string;
  readonly form: "symlink" | "fallback";
  readonly reason?: string;
};

export interface GitAdapter {
  isAvailable(): Promise<boolean>;
  isInitialized(dir: string): Promise<boolean>;
  init(dir: string): Promise<void>;
  /**
   * Returns the URL for `git remote get-url <remote>` in `dir`, or `null`
   * if the directory is not a git repo, the remote does not exist, or git
   * is not on PATH. Used at init time to derive the GitHub `repo` field
   * from the user's `origin` remote when they provide a Project URL.
   */
  getRemoteUrl(dir: string, remote: string): Promise<string | null>;
}

export interface ReleaseChecker {
  getLatest(): Promise<Release>;
}

export interface Downloader {
  download(url: string): Promise<Uint8Array>;
  downloadText(url: string): Promise<string>;
}

export interface SubprocessRunner {
  run(cmd: string, args: string[], opts?: SubprocessOptions): Promise<SubprocessResult>;
}

export type SubprocessOptions = {
  cwd?: string;
  stdin?: string;
  env?: Record<string, string>;
};

export type SubprocessResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export interface EnvironmentProbe {
  probeGit(): Promise<CheckOutcome>;
  probeGh(): Promise<CheckOutcome>;
  probeDeno(): Promise<CheckOutcome>;
}

export interface ProjectInspector {
  inspect(projectDir: string, templatesVersion: string): Promise<CheckOutcome[]>;
}

export interface LockStore {
  read(projectDir: string): Promise<InstalledLock | null>;
  write(projectDir: string, lock: InstalledLock): Promise<void>;
  lockPath(projectDir: string): string;
}

/** `null`: nothing there, even under no project dir yet. A throw is never absence. */
export interface FsReader {
  readText(projectDir: string, rel: string): Promise<string | null>;
  /**
   * What is at `rel` itself, judged with `lstat` — a link is reported as a
   * link, never read through (cli#680). `null` when nothing is there.
   */
  readEntry(projectDir: string, rel: string): Promise<DiskEntry | null>;
}

/**
 * Filesystem-backed store for `.specnaut/preserve.yml` — the maintainer's
 * preserve declarations (spec 011 / issue #367).
 *
 * Mirrors {@link LockStore}: an absent manifest reads as
 * `EMPTY_PRESERVE_CONFIG` (the feature is inert when no file exists, FR-011),
 * and a malformed manifest degrades to empty rather than aborting a refresh —
 * the handler surfaces the warning.
 */
export interface PreserveStore {
  read(projectDir: string): Promise<PreserveConfig>;
  write(projectDir: string, cfg: PreserveConfig): Promise<void>;
  /**
   * Why the manifest yielded what it yielded, or `null` when there is no
   * manifest. `read` cannot answer this: it returns an empty config for an
   * absent file and for a malformed one alike, which is what let a broken
   * manifest read as protection.
   */
  diagnose(projectDir: string): Promise<PreserveManifestDiagnosis | null>;
}

/**
 * Resolves the enclosing-workspace facts that drive parent-managed
 * detection. The **only** abstraction that touches the filesystem for
 * detection — keeps the use cases pure and unit-testable with fakes.
 *
 * See `docs`/the 009-parent-managed-init spec: a *providing Specnaut
 * workspace* is an ancestor that owns the centralised skills/agents and
 * declares the target as a workspace member.
 */
export interface ParentWorkspaceReader {
  /**
   * Walks `dirname(targetDir)` upward to the filesystem root and returns the
   * canonical path of the **first** ancestor `A` such that `A/.specnaut/`
   * exists AND `A/deno.json` declares a `workspace` member that, resolved
   * relative to `A` and canonicalised, equals the canonicalised `targetDir`.
   * Returns `null` if no such ancestor exists or the root is reached.
   */
  findProvidingAncestor(targetDir: string): Promise<string | null>;

  /**
   * True iff `targetDir/.specnaut/standalone.yml` exists. Contents ignored —
   * the marker's mere presence forces the full standalone provisioning path.
   */
  hasStandaloneOverride(targetDir: string): Promise<boolean>;
}

/**
 * Detects whether a Claude Code plugin is installed, and what it serves.
 *
 * The default implementation reads `~/.claude/plugins/installed_plugins.json`
 * and falls back to walking `~/.claude/plugins/cache/<marketplace>/<plugin>/`;
 * test seams can stub both methods.
 *
 * Used by the upgrade use case to drive the binary → plugin migration table:
 * when the plugin is installed AND serves a given path, a vanilla on-disk copy
 * is migrated away; a customized one is preserved with a warning.
 */
export interface PluginDetector {
  isPluginInstalled(name: string): Promise<boolean>;

  /**
   * Does the installed plugin actually carry `pluginRelPath` (plugin-root
   * relative, e.g. `skills/task/SKILL.md`)?
   *
   * Migration used to be decided by a compile-time list alone, which describes
   * what the plugin is EXPECTED to ship rather than what the user's installed
   * version does. A user on an older release would have files deleted that
   * their plugin has never heard of, leaving no copy anywhere. This is the
   * question that cannot be answered at compile time (cli#606).
   */
  pluginHasPath(name: string, pluginRelPath: string): Promise<boolean>;
}

/**
 * Backend abstraction over a project's spec storage (spec 020, data-model.md).
 * Scoped to the cloud-only verbs: the `local` adapter rejects both with a clear
 * "cloud-only" message, and the local authoring flow bypasses this port entirely
 * so its behaviour stays byte-identical to the pre-feature CLI (FR-003, D1).
 */
export interface SpecStore {
  readonly key: SpecBackend;
  /**
   * Fetch a task's spec steps. `null` when the task has no spec yet (not an
   * error). Cloud adapter delegates to a `SpecSession`; local adapter rejects.
   */
  pull(taskNumber: number): Promise<readonly SpecStep[] | null>;
  /**
   * Upsert-only push of a task's steps — never deletes an omitted step
   * (Lot 1 FR-011). Cloud adapter delegates to a `SpecSession`; local rejects.
   */
  push(taskNumber: number, steps: readonly SpecStep[]): Promise<void>;
}

/**
 * Gitignored materialisation cache for a cloud spec (spec 020) — the on-disk
 * mirror agents read as ordinary files, under `.specnaut/specs/.cache/<task>/`.
 * Disposable and never the source of truth; the cloud (or local files) is
 * authoritative. Adapter: `infrastructure/spec/spec_cache_writer.ts`.
 */
export interface SpecCacheStore {
  /**
   * Clear the task's cache dir, then write one ordered markdown file per step.
   * Returns the project-relative paths written (US3 AC2 — stale files are
   * reconciled by the clear-first write).
   */
  write(projectDir: string, taskNumber: number, steps: readonly SpecStep[]): Promise<string[]>;
  /** Read the task's cached steps back (for `spec push`), or `null` if absent. */
  read(projectDir: string, taskNumber: number): Promise<readonly SpecStep[] | null>;
  /** Remove the task's cache dir. Idempotent. */
  clear(projectDir: string, taskNumber: number): Promise<void>;
}

export interface Harness {
  readonly key: string;
  readonly displayName: string;
  /** Folders `upgrade` may remove an orphan from (cli#665); see `orphanScope`. */
  readonly managedRoots?: ReadonlyArray<string>;
  /**
   * Files, by exact name, `upgrade` may remove as orphans although no managed
   * root holds them (cli#681): a retired file directly in the harness folder,
   * whose siblings are the user's (`.codex/config.toml`).
   */
  readonly managedFiles?: ReadonlyArray<string>;
  /**
   * Set by a harness that runs project hooks only once the user trusts them and
   * hashes what it trusted (Codex): the paths whose change voids that trust, and
   * the note `init` / `upgrade` print when a run changed one (`hook_trust.ts`).
   */
  readonly hookTrust?: HookTrust;
  mapBundle(core: CoreBundle, opts: BundleOptions): Bundle;
}

/**
 * Filesystem-backed store for `.specnaut/upgrade-pending.json`.
 *
 * Written by `specnaut upgrade` on every applied upgrade.
 * Read by `specnaut-guide review-upgrade` and by `specnaut reconcile`.
 * Deleted at the end of a successful review.
 */
export interface UpgradeMarkerStore {
  read(projectDir: string): Promise<UpgradeMarker | null>;
  write(projectDir: string, marker: UpgradeMarker): Promise<void>;
  delete(projectDir: string): Promise<void>;
}

/**
 * Filesystem-backed access to `.specnaut/upgrade-staging/`. The staging
 * directory holds upstream versions of files that the upgrade preserved
 * (customized locally). `specnaut reconcile` consumes the directory.
 */
export interface StagingStore {
  /** Project-relative paths currently in the staging directory. */
  list(projectDir: string): Promise<string[]>;
  /** Read upstream content for a project-relative path. `null` if absent. */
  read(projectDir: string, relPath: string): Promise<string | null>;
  /** Remove the staging entry for a path. Idempotent. */
  delete(projectDir: string, relPath: string): Promise<void>;
  /** If the staging dir is empty, remove it. Returns whether it was removed. */
  cleanupIfEmpty(projectDir: string): Promise<boolean>;
}
