import type { Bundle } from "../domain/template.ts";
import type { Release } from "../domain/release.ts";
import type { CheckOutcome } from "../domain/check_result.ts";
import type { InstalledLock } from "../domain/installed_lock.ts";
import type { PreserveConfig, PreserveManifestDiagnosis } from "../domain/preserve_config.ts";

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
   * relative, e.g. `skills/board/SKILL.md`)?
   *
   * Migration used to be decided by a compile-time list alone, which describes
   * what the plugin is EXPECTED to ship rather than what the user's installed
   * version does. A user on an older release would have files deleted that
   * their plugin has never heard of, leaving no copy anywhere. This is the
   * question that cannot be answered at compile time (cli#606).
   */
  pluginHasPath(name: string, pluginRelPath: string): Promise<boolean>;
}

import type { CoreBundle } from "../domain/core_bundle.ts";
import type { BacklogBackend, SpecBackend, VersionScheme } from "../domain/installed_lock.ts";
import {
  KNOWN_BACKLOG_BACKENDS,
  KNOWN_SPEC_BACKENDS,
  KNOWN_VERSION_SCHEMES,
} from "../domain/installed_lock.ts";
import type { SpecStep } from "../domain/spec/spec_step.ts";

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
  /**
   * Which spec backend's conditional sections the phase docs should keep
   * (spec 020). The consuming phase docs (`specify` / `implement` / `review` /
   * `analyze` / `tasks`) carry `spec-backend=local|cloud` marker blocks rendered
   * against this value at bundle time. `local` yields output byte-identical to
   * the pre-feature CLI (FR-003).
   */
  readonly specBackend: SpecBackend;
  /**
   * Whether cloud-mode task creation should also auto-generate the task's spec
   * (spec 021 / FR-005). Governs the `spec-autogen=on` guidance block in the
   * backlog skill. Absent ⇒ `false` (opt-in, default off); the guidance only
   * renders when `specAutogen && specBackend === "cloud"`.
   */
  readonly specAutogen?: boolean;
};

/**
 * The value domain of every field of {@link BundleOptions} — the install
 * parameter space, in one place.
 *
 * **Keyed by `keyof Required<BundleOptions>`, and that is the whole point.**
 * A field added to `BundleOptions` makes this object literal fail to compile
 * with "property is missing", so the parameter space cannot silently narrow.
 * `Required<…>` is what extends that guarantee to *optional* fields, which is
 * where it was needed: `specAutogen` is optional, so every caller that never
 * mentioned it compiled fine and pinned it to `false` — and the guard that
 * measures Windsurf workflow sizes did exactly that, measuring 16 of 32
 * combinations while reporting itself green over a workflow that was 539
 * characters past the vendor's cap (#562).
 *
 * The values are **imported**, never retyped. `KNOWN_*` in
 * `domain/installed_lock.ts` is the single source for what values exist; a
 * hand-written copy here would be a fourth mirror of those lists, and this
 * repository already carries a scar from that shape (see
 * `domain/plugin_coverage.ts`).
 */
export const BUNDLE_OPTION_DOMAINS: {
  readonly [K in keyof Required<BundleOptions>]: ReadonlyArray<Required<BundleOptions>[K]>;
} = {
  backlogBackend: KNOWN_BACKLOG_BACKENDS,
  versionScheme: KNOWN_VERSION_SCHEMES,
  specBackend: KNOWN_SPEC_BACKENDS,
  specAutogen: [false, true],
};

/**
 * Every combination of {@link BUNDLE_OPTION_DOMAINS}, as the cross-product.
 *
 * Use this instead of nested `for` loops. A loop spells the axes it happens to
 * remember; this one cannot forget a field, because the field list is the type.
 * Order is the declaration order of `BUNDLE_OPTION_DOMAINS`, so the output is
 * stable and a failure message can name a combination reproducibly.
 */
export function everyBundleOption(): ReadonlyArray<Required<BundleOptions>> {
  const keys = Object.keys(BUNDLE_OPTION_DOMAINS) as Array<keyof Required<BundleOptions>>;
  let combos: Array<Record<string, unknown>> = [{}];
  for (const key of keys) {
    const widened: Array<Record<string, unknown>> = [];
    for (const combo of combos) {
      for (const value of BUNDLE_OPTION_DOMAINS[key]) {
        widened.push({ ...combo, [key]: value });
      }
    }
    combos = widened;
  }
  return combos as unknown as ReadonlyArray<Required<BundleOptions>>;
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
  mapBundle(core: CoreBundle, opts: BundleOptions): Bundle;
}

import type { UpgradeMarker } from "../domain/upgrade_marker.ts";

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
