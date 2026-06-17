import type { Bundle } from "../domain/template.ts";
import type { Release } from "../domain/release.ts";
import type { CheckOutcome } from "../domain/check_result.ts";
import type { InstalledLock } from "../domain/installed_lock.ts";
import type { PreserveConfig } from "../domain/preserve_config.ts";

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
    options: { backupExisting: boolean },
  ): Promise<BackupReport>;
}

export type BackupReport = {
  readonly backups: ReadonlyArray<{ readonly dest: string; readonly backupPath: string }>;
  /**
   * Dests that were silently skipped because the file pre-existed AND the
   * bundle entry had `skipIfExists: true` (placeholder semantics — the
   * user's existing content always wins). Always present; empty when no
   * placeholder skipping happened. The init use case omits these dests
   * from the lock since they aren't Specnaut-managed.
   */
  readonly skippedSkipIfExists: ReadonlyArray<string>;
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

export interface FsReader {
  readText(projectDir: string, rel: string): Promise<string | null>;
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
 * Detects whether a Claude Code plugin is currently installed.
 *
 * The default implementation probes
 * `~/.claude/plugins/cache/<name>/` (per the Claude Code
 * discover-plugins docs); test seams can stub this to return any value.
 *
 * Used by the upgrade use case to drive the binary → plugin migration
 * table: when the plugin is installed, vanilla on-disk agent files are
 * auto-migrated; customized files are preserved with a warning.
 */
export interface PluginDetector {
  isPluginInstalled(name: string): Promise<boolean>;
}

import type { CoreBundle } from "../domain/core_bundle.ts";
import type { BacklogBackend, VersionScheme } from "../domain/installed_lock.ts";

export type BundleOptions = {
  /**
   * Which backlog backend's conditional sections and scripts the harness
   * should keep. Entries tagged with a different backend are filtered out;
   * the bundled SKILL.md is rendered with the matching markers stripped.
   */
  readonly backlogBackend: BacklogBackend;
  /**
   * Which versioning scheme the tag-release pack should compile down to.
   * `phase-script` entries with `# BEGIN: scheme=X` markers are rendered
   * against this value at bundle time.
   */
  readonly versionScheme: VersionScheme;
};

export interface Harness {
  readonly key: string;
  readonly displayName: string;
  mapBundle(core: CoreBundle, opts: BundleOptions): Bundle;
}

import type { UpgradeMarker } from "../domain/upgrade_marker.ts";

/**
 * Filesystem-backed store for `.specnaut/upgrade-pending.json`.
 *
 * Written by `specnaut upgrade` on every applied upgrade.
 * Read by `specnaut-expert review-upgrade` and by `specnaut reconcile`.
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
