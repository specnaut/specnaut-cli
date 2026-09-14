import type {
  BackupReport,
  FsReader,
  FsWriter,
  Harness,
  LockStore,
  PluginDetector,
} from "./ports.ts";
import type { Bundle, TemplateFile } from "../domain/template.ts";
import { managedSectionLabels } from "../domain/template.ts";
import { sha256Hex } from "../domain/sha256.ts";
import type { InstalledLock, LockEntry } from "../domain/installed_lock.ts";
import type { CoreBundle } from "../domain/core_bundle.ts";
import { renameEndpointEntry, SKILL_DOC_RENAMES } from "../domain/skill_doc_renames.ts";
import {
  computeUpgradePlan,
  type UpgradeAction,
  type UpgradePlan,
} from "../domain/upgrade_plan.ts";
import {
  canonicalBlockBody,
  extractBlock,
  mergeIntoFile,
  mergeRefusal,
} from "../domain/merge_block.ts";
import { isPluginCoveredPath, pluginRelativePath } from "../domain/plugin_coverage.ts";
import { isAgenticPath, pruneAgenticEntries } from "../domain/parent_managed.ts";

/** The plugin name used for both the install probe and the cache directory. */
export const PLUGIN_NAME = "specnaut-plugin";

export type UpgradeProjectInput = {
  projectDir: string;
  dryRun: boolean;
  force: boolean;
  /**
   * `--reset-baseline` flag. Heals stale lock SHAs left by older binaries
   * (and any other source of disk/lock divergence) by trusting the
   * on-disk content as the new baseline. Existing files where
   * `diskSha != lockSha` get their lock SHA force-reset; the plan then
   * compares disk vs bundle directly. Use after the user confirms they
   * never edited the affected files.
   */
  resetBaseline?: boolean;
  /**
   * Parent-managed decision re-derived by the handler when the lock predates
   * the `parent_managed` field (009-parent-managed-init). When provided it
   * takes precedence over `lock.parentManaged`, and the value is persisted into
   * the rewritten lock so subsequent upgrades read it directly. Absent ⇒ the
   * decision is read from `lock.parentManaged` (already cached) or treated as
   * `false`.
   */
  parentManagedOverride?: boolean;
  /**
   * Declared-preserve predicate (spec 011 / issue #367). Returns true for any
   * dest the maintainer listed in `.specnaut/preserve.yml`. Threaded straight
   * into `computeUpgradePlan` so declared files become `preserve/"declared"`
   * (winning over auto-update, plugin-migration, and removal). Built by the
   * handler from the manifest (and flipped off when `--reset-preserved` is
   * passed); the use case never reads the manifest or any CLI flag. Absent ⇒
   * no declared preserves (today's behaviour).
   */
  isDeclaredPreserved?: (dest: string) => boolean;
};

/**
 * What `upgrade` did to a Specnaut-owned section inside a user-owned file
 * (#466). Reported so the run ends with the user either having the section or
 * being told, in the same output, that they do not.
 */
export type ManagedSectionOutcome = {
  readonly dest: string;
  readonly label: string;
  /** `added` — the file had no such block. `refreshed` — it did, and it moved. */
  readonly kind: "added" | "refreshed";
};

export type UpgradeProjectResult =
  | {
    status: "up-to-date";
    currentVersion: string;
    /**
     * Refusals still reach the user on the path where NOTHING else changed.
     *
     * That is not an edge case, it is the likely one: a project whose only
     * outstanding difference is the refused file lands here, so a result type
     * without this field dropped the message on exactly the run that needed it.
     */
    refusals: ReadonlyArray<string>;
  }
  | {
    status: "planned";
    /**
     * Merges this run declined because the host file could not safely take the
     * block — e.g. a `.codex/config.toml` already declaring `[agents]`
     * (cli#599). Carried on the result rather than logged, because a refusal
     * the user never sees is the same as the silent skip it replaced.
     */
    refusals: ReadonlyArray<string>;
    plan: UpgradePlan;
    fromVersion: string;
    toVersion: string;
    managedSections: ReadonlyArray<ManagedSectionOutcome>;
  }
  | {
    status: "applied";
    /**
     * Merges this run declined because the host file could not safely take the
     * block — e.g. a `.codex/config.toml` already declaring `[agents]`
     * (cli#599). Carried on the result rather than logged, because a refusal
     * the user never sees is the same as the silent skip it replaced.
     */
    refusals: ReadonlyArray<string>;
    plan: UpgradePlan;
    fromVersion: string;
    toVersion: string;
    backups: ReadonlyArray<string>;
    /** Backups that moved a SYMLINK rather than content (cli#574). */
    linksMoved: ReadonlyArray<string>;
    managedSections: ReadonlyArray<ManagedSectionOutcome>;
    /**
     * Dests whose content this run actually wrote from the bundle.
     *
     * The plan is a forecast, and the report used to render it as the outcome
     * (#519). Under `--force` that is not merely imprecise: every overwritten
     * file was still listed under "customized locally (not touched)", and the
     * files that *did* receive their delayed update were the ones the run
     * warned had missed it. A forecast and a result are different objects, so
     * the result now carries its own.
     */
    written: ReadonlyArray<string>;
  };

export type UpgradeProjectDeps = {
  reader: FsReader;
  writer: FsWriter;
  lockStore: LockStore;
  core: CoreBundle;
  templatesVersion: string;
  findHarness: (key: string) => Harness | null;
  /**
   * Optional plugin probe. Drives the binary → plugin migration table —
   * when the plugin is installed and the harness is `claude`, vanilla
   * on-disk agent / skill files are auto-migrated (backed up + deleted;
   * plugin serves them going forward) and customized files are
   * preserved with a "plugin available" warning. Tests omit this dep
   * to skip migration entirely.
   */
  pluginDetector?: PluginDetector;
  now?: () => Date;
};

export class UpgradeProjectUseCase {
  constructor(private readonly deps: UpgradeProjectDeps) {}

  async execute(input: UpgradeProjectInput): Promise<UpgradeProjectResult> {
    const { reader, writer, lockStore, core, templatesVersion, findHarness } = this.deps;

    const lock = await lockStore.read(input.projectDir);
    if (lock === null) {
      throw new Error(
        "no .specnaut/installed.lock found. Run `specnaut init --here --force` to enable upgrades.",
      );
    }
    const harness = findHarness(lock.harness);
    if (!harness) {
      throw new Error(`unknown harness in lock: ${lock.harness}`);
    }
    const mappedBundle = harness.mapBundle(core, {
      backlogBackend: lock.backlogBackend,
      versionScheme: lock.versionScheme,
      specBackend: lock.specBackend,
      specAutogen: lock.specAutogen,
    });

    // Parent-managed targets inherit agentic files from the providing
    // workspace. Drop agentic dests from the full bundle *before* the plan is
    // computed so suppressed paths are never planned, written, or "restored"
    // (FR-007). The decision comes from the handler's re-derivation override
    // (legacy lock) or the cached `lock.parentManaged`.
    const parentManaged = input.parentManagedOverride ?? lock.parentManaged ?? false;
    const fullBundle: Bundle = parentManaged
      ? Object.fromEntries(
        Object.entries(mappedBundle).filter(([dest]) => !isAgenticPath(dest)),
      )
      : mappedBundle;

    // JSON-merged files (e.g. `.claude/settings.json`) are user-owned: we
    // never overwrite them, only graft our entries in. They live outside
    // the lock-tracked plan and are re-merged at the end as a flat write.
    const jsonMergedBundle: Bundle = {};
    const bundle: Bundle = {};
    for (const [dest, file] of Object.entries(fullBundle)) {
      if (file.mergeJson !== undefined) {
        jsonMergedBundle[dest] = file;
      } else {
        bundle[dest] = file;
      }
    }

    // Refuse a merge whose host file cannot safely take the block (cli#599).
    //
    // Dropped from the bundle BEFORE the plan is computed, so the refused path
    // is never planned, written, or lock-tracked — an entry for a file we
    // deliberately did not write would report as drift on every later run.
    const refusals: string[] = [];
    const refusedDests = new Set<string>();
    for (const [dest, file] of Object.entries(bundle)) {
      if (file.mergeRefuseIf === undefined) continue;
      const refusal = mergeRefusal(await reader.readText(input.projectDir, dest), file);
      if (refusal === null) continue;
      refusals.push(refusal);
      delete bundle[dest];
      refusedDests.add(dest);
    }

    const destPaths = new Set<string>([
      ...Object.keys(bundle),
      ...lock.entries.keys(),
    ]);
    const diskShas = new Map<string, string>();
    for (const dest of destPaths) {
      const content = await reader.readText(input.projectDir, dest);
      if (content === null) continue;
      // For mergeable files we hash the *block content only* (not the whole
      // user-owned file) so the SHA is comparable against the lock entry,
      // which also stores only the block content.
      const file = bundle[dest];
      if (file?.mergeBlock !== undefined) {
        const block = extractBlock(content, file.mergeBlock) ?? "";
        diskShas.set(dest, await sha256Hex(block));
      } else {
        diskShas.set(dest, await sha256Hex(content));
      }
    }

    // --- Renamed documents carry their lock identity across the move ---------
    //
    // A sub-document that changed address is otherwise TWO unrelated events: an
    // orphan at the old path and an add-new at the new one. The user's bytes
    // survive — a customised orphan is removed only under `--force`, with a
    // backup — but they stop being READ. The agent loads the vanilla document
    // at the new address while the edit sits at the old one, behind a success
    // message. A release guardrail that stops firing silently is worse than one
    // that is deleted loudly.
    //
    // Moving the lock entry makes it ONE event, so the ordinary customized /
    // vanilla logic below applies at the new address with no special case: a
    // vanilla file updates, a customised one lands in the `customized` bucket
    // where the summary names it.
    const bundleOpts = {
      backlogBackend: lock.backlogBackend,
      versionScheme: lock.versionScheme,
      specBackend: lock.specBackend,
      specAutogen: lock.specAutogen,
    };
    /** Destinations this harness emits regardless of the bundle. */
    const harnessOnlyDests = harness.mapBundle([], bundleOpts);
    const destFor = (owner: string, doc: string): string | null => {
      // Ask the HARNESS where it puts this document. Composing the path here
      // would be a second statement of the adapter's rule (spec 033 §5) — and
      // it is harness-specific, so any literal would be wrong on six of seven.
      const mapped = harness.mapBundle([renameEndpointEntry(owner, doc)], bundleOpts);
      return Object.keys(mapped).find((d) => !(d in harnessOnlyDests)) ?? null;
    };

    const applicable: Array<{ oldDest: string; newDest: string; reason: string }> = [];
    for (const r of SKILL_DOC_RENAMES) {
      const oldDest = destFor(r.from.owner, r.from.doc);
      const newDest = destFor(r.to.owner, r.to.doc);
      if (oldDest === null || newDest === null) continue;
      // Only when the project is actually mid-migration: the old path is
      // tracked AND present, the new document ships now, and nothing has
      // already claimed the new path.
      if (!lock.entries.has(oldDest)) continue;
      if (!diskShas.has(oldDest)) continue;
      if (!(newDest in bundle)) continue;
      if (lock.entries.has(newDest)) continue;
      applicable.push({ oldDest, newDest, reason: r.reason });
    }

    // A refused dest must leave the LOCK as well as the bundle.
    //
    // Dropping it from the bundle alone leaves its lock entry behind, and a
    // dest that is in the lock but not in the bundle is an ORPHAN — so the very
    // next plan removed the user's `.codex/config.toml` instead of leaving it
    // alone. Refusing to write a file must never be a route to deleting it.
    // Caught by the end-to-end test; the merge-level unit tests could not see
    // it, because the deletion happens nowhere near the merge.
    const lockForPlan = refusedDests.size === 0 ? lock : {
      ...lock,
      entries: new Map(
        [...lock.entries].filter(([dest]) => !refusedDests.has(dest)),
      ),
    };

    let effectiveLock = lockForPlan;
    if (applicable.length > 0) {
      const entries = new Map(lockForPlan.entries);
      for (const { oldDest, newDest } of applicable) {
        const entry = entries.get(oldDest)!;
        entries.delete(oldDest);
        entries.set(newDest, entry);
        const sha = diskShas.get(oldDest)!;
        diskShas.set(newDest, sha);
        diskShas.delete(oldDest);
      }
      effectiveLock = { ...lockForPlan, entries };

      // The maps above are enough for `--dry-run` to report the move
      // faithfully; the bytes only travel on a real run.
      if (!input.dryRun) {
        const moved: Bundle = {};
        for (const { oldDest, newDest } of applicable) {
          const content = await reader.readText(input.projectDir, oldDest);
          if (content === null) continue;
          moved[newDest] = { content, executable: false };
        }
        if (Object.keys(moved).length > 0) {
          await writer.writeBundle(moved, input.projectDir, { overwrite: true });
          await writer.deletePaths(
            applicable.map((a) => a.oldDest),
            input.projectDir,
            // No backup: the bytes were moved, not discarded. A backup here
            // would leave a `.specnaut.bak` beside every renamed file on an
            // upgrade that lost nothing.
            { backupExisting: false },
          );
        }
      }
    }

    const newShas = new Map<string, string>();
    for (const [dest, file] of Object.entries(bundle)) {
      const shaInput = file.mergeBlock !== undefined
        ? canonicalBlockBody(file.content)
        : file.content;
      newShas.set(dest, await sha256Hex(shaInput));
    }

    const isDeclaredPreserved = input.isDeclaredPreserved ?? (() => false);
    const detector = this.deps.pluginDetector;
    const pluginInstalled = detector !== undefined &&
      await detector.isPluginInstalled(PLUGIN_NAME);

    // Ask the INSTALLED plugin what it actually serves, rather than trusting
    // the compile-time coverage list on its own (cli#606).
    //
    // `PLUGIN_COVERED_PATHS_CLAUDE` describes what the plugin is expected to
    // ship. A user on an older plugin release has covered paths their build has
    // never heard of — and migrating one deletes the project's only copy while
    // nothing takes over serving it. The list says "the plugin owns this
    // path"; only the tree can say "this install has it".
    //
    // Resolved here, not inside `computeUpgradePlan`, because the plan is a
    // pure synchronous function and this question is a filesystem probe. The
    // probe runs only when the plugin is installed: on every other run the
    // answer cannot change the outcome, so it is not worth a single stat.
    const servedByPlugin = new Set<string>();
    if (pluginInstalled && detector !== undefined) {
      for (const dest of newShas.keys()) {
        if (!isPluginCoveredPath(lock.harness, dest)) continue;
        const rel = pluginRelativePath(dest);
        if (rel === null) continue;
        if (await detector.pluginHasPath(PLUGIN_NAME, rel)) servedByPlugin.add(dest);
      }
    }

    const plan = computeUpgradePlan(
      diskShas,
      effectiveLock,
      newShas,
      {
        pluginInstalled,
        isPluginCovered: (dest) => servedByPlugin.has(dest),
        isSkipIfExists: (dest) => bundle[dest]?.skipIfExists === true,
        resetBaseline: input.resetBaseline ?? false,
        isDeclaredPreserved,
      },
    );

    // A declared-preserve (spec 011 / issue #367) is immune to `--force`: the
    // maintainer overrides it only via `--reset-preserved` (which flips the
    // predicate off, so the file never reaches here as reason:"declared").
    // Only a `customized` preserve is overwritten by `--force`.
    const isForceWritablePreserve = (a: UpgradeAction): boolean =>
      a.kind === "preserve" && a.reason === "customized" && input.force;

    // Sections Specnaut owns inside files the user owns (#466). These live
    // outside the plan on purpose: `AGENTS.md` is `skipIfExists`, so an upgrade
    // never writes it — which is correct for the file and wrong for the one
    // section that has to reach a project that upgrades rather than inits.
    // Merged in under their own fence, they never overwrite or reorder a line
    // the user wrote.
    const plannedSections = await this.surveyManagedSections(
      bundle,
      input.projectDir,
      isDeclaredPreserved,
    );

    const hasActualWork = plan.some((a) =>
      a.kind === "auto-update" ||
      a.kind === "add-new" ||
      a.kind === "migrate-to-plugin" ||
      a.kind === "defer-to-plugin" ||
      isForceWritablePreserve(a) ||
      (a.kind === "remove" && (!a.wasCustomized || input.force))
    );
    if (
      !hasActualWork && plannedSections.length === 0 &&
      plan.every((a) => a.kind === "unchanged")
    ) {
      // No file work to do. But a legacy lock (or any lock whose recorded
      // `parent_managed` differs from the decision we just computed) still
      // needs the corrected field persisted — otherwise a handler-derived
      // override never reaches disk until an unrelated file change triggers
      // a rewrite (009-parent-managed-init / FR-007). This is a metadata-only
      // write: no file operations, just the lock. The common case (lock
      // already carries the right value) keeps the no-op fast path.
      const lockParentManaged = lock.parentManaged ?? false;
      // Rewrite when the decision changed OR when a parent-managed lock still
      // records agentic rows. The second case is the one that bites: a lock
      // written before the flip keeps describing files this workspace does not
      // own, and without it the resurrection only moves from "planned adds" to
      // phantom rows nobody looks at until they mislead someone (#476).
      // #572, third case, and the one that hides best. When EVERY dest is
      // `unchanged` the run returns here, before the lock rebuild below ever
      // sees them — so a project whose whole tree already matches the bundle
      // but whose lock is behind gets "up-to-date" and no repair at all. Both
      // other cases at least reached the rebuild. This one never did, which is
      // why it survived a fix aimed at the rebuild.
      //
      // A stale entry here is not ambiguous: `unchanged` means the file equals
      // the bundle, so the bundle's sha is what the entry should have said all
      // along.
      // Every dest here is `unchanged`, so the entry set is fully derivable:
      // sha and version come from the bundle, `installedAt` is kept when known.
      // Built from `newShas`, NOT from `effectiveLock.entries`, so an orphan row the
      // bundle no longer contains is dropped — the prune the rebuild loop gets
      // for free by iterating the same map, which this branch used to skip
      // because it copied the lock verbatim.
      const upToDateEntries = deriveUnchangedEntries(
        effectiveLock.entries,
        newShas,
        bundle,
        templatesVersion,
        (this.deps.now ?? (() => new Date()))().toISOString(),
      );
      // Stale on EITHER axis. Keying only on the sha let an entry keep a
      // lagging `templatesVersion` while the header advanced, which makes
      // `staleSince` fire on a file that was never behind — and
      // `--reset-baseline` is bounded by exactly that predicate, so a genuine
      // user edit gets swept into an overwrite by a report that was wrong.
      const staleEntries = [...upToDateEntries].some(([dest, e]) => {
        const prev = effectiveLock.entries.get(dest);
        return prev === undefined || prev.sha256 !== e.sha256 ||
          prev.templatesVersion !== e.templatesVersion;
      }) || [...effectiveLock.entries.keys()].some((d) => !upToDateEntries.has(d));
      const staleVersion = lock.templatesVersion !== templatesVersion;
      const staleAgentic = parentManaged &&
        [...effectiveLock.entries.keys()].some((dest) => isAgenticPath(dest));
      if (
        parentManaged !== lockParentManaged || staleAgentic ||
        staleEntries || staleVersion
      ) {
        const correctedLock: InstalledLock = {
          version: 2,
          harness: lock.harness,
          backlogBackend: lock.backlogBackend,
          versionScheme: lock.versionScheme,
          specBackend: lock.specBackend,
          specAutogen: lock.specAutogen,
          templatesVersion,
          entries: parentManaged ? pruneAgenticEntries(upToDateEntries) : upToDateEntries,
          ...(parentManaged ? { parentManaged: true as const } : {}),
        };
        // NOT on a dry run. `input.dryRun` is first consulted below, AFTER
        // this early return, so this write happened on a preview — and the new
        // `staleVersion` clause fires on the ordinary post-release state (files
        // current, version string behind), which means a preview would have
        // mutated the trust artefact on a perfectly normal tree. A preview that
        // writes is not a preview.
        if (!input.dryRun) {
          await lockStore.write(input.projectDir, correctedLock);
        }
      }
      // The version reported is the one now recorded, not the one that was.
      return { status: "up-to-date", currentVersion: templatesVersion, refusals };
    }

    // `--dry-run` returns here, BEFORE anything is written. It used to fall
    // through the staging block below on the argument that an agent could then
    // preview the reconciliation plan — but a preview that leaves several dozen
    // files on disk is not a preview, and the run ended by printing "no files
    // written". Worse, it primed `specnaut reconcile` with upstream content for
    // an upgrade that was never applied. The plan itself already names every
    // customized dest, which is what a preview owes the caller.
    if (input.dryRun) {
      return {
        status: "planned",
        refusals,
        plan,
        fromVersion: lock.templatesVersion,
        toVersion: templatesVersion,
        managedSections: plannedSections,
      };
    }

    // Stage upstream content for preserved (customized) files so that
    // `specnaut reconcile` can act on them later.
    const stagingWrites: Bundle = {};
    for (const action of plan) {
      // Stage only `customized` preserves for reconcile; a declared-preserve is
      // a deliberate freeze, not a pending reconciliation.
      if (action.kind !== "preserve" || action.reason !== "customized") continue;
      // And only if the lock can speak for it. `ReconcilePathUseCase` answers
      // `no-lock-entry` for a dest the lock does not carry, so staging one
      // produces a path `reconcile --status` lists forever and
      // `reconcile <path>` refuses — a pending item no command can clear.
      // Since #572 an unwritten preserve with no prior entry deliberately gets
      // no entry, which is exactly the population that would strand here.
      if (!effectiveLock.entries.has(action.dest)) continue;
      const file = bundle[action.dest];
      if (!file) continue;
      stagingWrites[`.specnaut/upgrade-staging/${action.dest}`] = file;
    }
    if (Object.keys(stagingWrites).length > 0) {
      await writer.writeBundle(stagingWrites, input.projectDir, {
        overwrite: true,
        backupExisting: false,
      });
    }

    const toWrite: Bundle = {};
    for (const action of plan) {
      if (
        action.kind === "auto-update" ||
        action.kind === "add-new" ||
        isForceWritablePreserve(action)
      ) {
        const file = bundle[action.dest];
        if (file) toWrite[action.dest] = file;
      }
    }

    // `--reset-baseline` overwrites from the bundle exactly like `--force` does,
    // so it owes the same `.specnaut.bak` (#519). It never wrote one: the flag
    // re-baselines before the plan is computed, so every file it touches arrives
    // here as `auto-update` rather than a forced `preserve`, and the backup was
    // keyed on `force` alone. The hint that advertises the flag promises "keeps
    // a .specnaut.bak of each" — it produced none, which made the safer-looking
    // option the destructive one.
    const backupReport = await writer.writeBundle(toWrite, input.projectDir, {
      overwrite: true,
      backupExisting: input.force || (input.resetBaseline ?? false),
    });

    // JSON-merged files are not part of the plan; re-graft the bundled
    // entries into whatever the user has on disk (idempotent — already-
    // present entries are skipped by the merge logic). Greenfield case
    // is handled too: writeBundle will just write the bundled content
    // when no file is present.
    if (Object.keys(jsonMergedBundle).length > 0) {
      await writer.writeBundle(jsonMergedBundle, input.projectDir, {
        overwrite: true,
        backupExisting: false,
      });
    }

    // Staged copies exist so `reconcile` can offer the upstream version of a
    // file this run refused to touch. A file the run actually WROTE has nothing
    // left to reconcile — its destination IS the upstream now — so its staged
    // copy is stale the moment `--force` overwrites it.
    //
    // Left behind, it inflated `reconcile --status` permanently: on this
    // workspace a forced upgrade reported 46 pending paths, of which 23 were
    // byte-identical to their staged copy. Half the queue was noise, and the
    // failure mode is an over-long list rather than an error, so nothing failed.
    //
    // Staging during a dry run stays exactly as it was — that is what lets an
    // agent preview the reconciliation plan, and dry runs return before this.
    const stagedForWritten = Object.keys(toWrite).map((dest) =>
      `.specnaut/upgrade-staging/${dest}`
    );
    if (stagedForWritten.length > 0) {
      await writer.deletePaths(stagedForWritten, input.projectDir, { backupExisting: false });
    }

    // Applied *after* the plan's writes: an `auto-update` may just have
    // rewritten the whole file from the bundle, in which case the section is
    // already there and the merge is a no-op. Re-reading is what keeps the
    // reported outcome honest instead of echoing back what we predicted.
    const appliedSections = await this.applyManagedSections(
      bundle,
      input.projectDir,
      isDeclaredPreserved,
    );

    const cleanRemovals = plan
      .filter((a): a is Extract<typeof a, { kind: "remove" }> =>
        a.kind === "remove" && !a.wasCustomized
      )
      .map((a) => a.dest);
    const customizedRemovals = plan
      .filter((a): a is Extract<typeof a, { kind: "remove" }> =>
        a.kind === "remove" && a.wasCustomized
      )
      .map((a) => a.dest);

    let extraBackups: BackupReport["backups"] = [];
    if (cleanRemovals.length > 0) {
      const r = await writer.deletePaths(cleanRemovals, input.projectDir, {
        backupExisting: false,
      });
      extraBackups = [...extraBackups, ...r.backups];
    }
    if (input.force && customizedRemovals.length > 0) {
      const r = await writer.deletePaths(customizedRemovals, input.projectDir, {
        backupExisting: true,
      });
      extraBackups = [...extraBackups, ...r.backups];
    }

    // Plugin migrations: vanilla file on disk + plugin installed →
    // backup + delete; plugin serves the file going forward. Always
    // back up (the on-disk copy is exactly what the plugin will serve,
    // but the user may want to recover it later if they uninstall the
    // plugin).
    const pluginMigrations = plan
      .filter((a): a is Extract<typeof a, { kind: "migrate-to-plugin" }> =>
        a.kind === "migrate-to-plugin"
      )
      .map((a) => a.dest);
    if (pluginMigrations.length > 0) {
      const r = await writer.deletePaths(pluginMigrations, input.projectDir, {
        backupExisting: true,
      });
      extraBackups = [...extraBackups, ...r.backups];
    }

    const now = (this.deps.now ?? (() => new Date()))().toISOString();
    // Dests handed off to the plugin are dropped from the new lock —
    // the binary is no longer the owner of those files.
    const droppedToPlugin = new Set<string>(
      plan
        .filter((a) => a.kind === "migrate-to-plugin" || a.kind === "defer-to-plugin")
        .map((a) => a.dest),
    );
    // #572. A dest the plan classified `unchanged` has disk content that
    // ALREADY equals the bundle — that is the definition of the branch. Its
    // lock entry was nevertheless carried over verbatim, because `wrote` is
    // false for anything outside `toWrite`, so a project whose lock had fallen
    // behind kept a sha matching NEITHER the file NOR the bundle, forever.
    // `upgrade` could not heal it (nothing to write), and `--reset-baseline`
    // could not either (it assigns a local `lockSha` inside the planner and
    // never reaches `lock.entries`). The only remaining remedy was editing the
    // lock by hand, which is the opposite of what a lock is for.
    //
    // This is NOT the freeze the `staleSince` doc describes and deliberately
    // leaves alone. That one is about a **customized** preserve, where the
    // frozen `templatesVersion` is the only record of when the divergence
    // began and re-stamping would destroy it. Here there is no divergence to
    // record: the file and the bundle agree.
    const unchangedDests = new Set(
      plan.filter((a) => a.kind === "unchanged").map((a) => a.dest),
    );
    const updatedEntries = new Map<string, LockEntry>();
    for (const [dest] of newShas) {
      if (droppedToPlugin.has(dest)) continue;
      const existing = effectiveLock.entries.get(dest);
      const sha = await shaOfBundle(bundle[dest]);
      const wrote = toWrite[dest] !== undefined;
      // A `skipIfExists` file the user already had is theirs, and init
      // deliberately left it out of the lock. An upgrade that did not write it
      // must not adopt it either: recording the BUNDLE's sha against THEIR
      // file makes every later upgrade report it as "customized locally" and
      // dump a full diff — and makes `--force` overwrite it. That is the #163
      // false positive, arriving one run later through the lock instead of
      // through the plan.
      //
      // This drops a PRE-EXISTING entry too, and that is the point. The guard
      // used to require `existing === undefined`, so it only ever prevented
      // adoption on a clean lock — a project whose lock already carried the
      // dest (tracked by an older binary, or by a partial upgrade) kept that
      // entry forever, which is precisely what disarmed the plan-side guard.
      // Dropping it here heals the project on its next upgrade, without the
      // user needing to know the problem existed.
      if (!wrote && bundle[dest]?.skipIfExists === true) continue;
      // True when the file on disk holds this bundle's content — either
      // because we just wrote it, or because it already did.
      const matchesBundle = wrote || unchangedDests.has(dest);
      // An unwritten dest with no prior entry gets NO entry — the same refusal,
      // for the same reason, one branch over.
      //
      // The first version of this fix recorded `diskShas.get(dest)` here. That
      // was aimed at a DECLARED preserve after a template rename, but nothing
      // gated it on the reason, so it fired for a `customized` preserve too —
      // the `lockSha === undefined` branch, whose own comment reads "the user's
      // own edit of a file Specnaut manages". Recording the user's sha as the
      // installed baseline makes the NEXT run see `diskSha === lockSha`,
      // classify the file `auto-update`, and overwrite it — with no
      // `.specnaut.bak`, because a plain upgrade passes `backupExisting: false`.
      // Two runs, no flag, no warning, and the edits are gone.
      //
      // Recording nothing keeps the file exactly as untracked as it was, so the
      // next run reaches the same branch and preserves it again. The ticket's
      // own criterion allows "the disk sha OR no entry at all"; only one of the
      // two is safe for both reasons, so it is the one taken.
      if (!wrote && existing === undefined && !matchesBundle) continue;
      updatedEntries.set(dest, {
        // `existing` is defined here whenever `matchesBundle` is false — the
        // guard above returned for every other case — so no fallback sha is
        // reachable and none is offered. The old `?? sha` recorded the BUNDLE's
        // sha against a file the run refused to touch; its replacement recorded
        // the user's, which was worse.
        sha256: matchesBundle ? sha : existing?.sha256 ?? sha,
        // NOT re-stamped for `unchanged`. The content matches the bundle, but
        // it did not arrive now — it arrived whenever it was last written, and
        // that is what the recorded value says. Overwriting it would trade a
        // known date for a false one and buy nothing: no consumer reads
        // `installedAt` to decide anything, and the one place it is read
        // (`staleSince`) only fires on customized preserves, which this branch
        // never touches.
        installedAt: wrote ? now : (existing?.installedAt ?? now),
        templatesVersion: matchesBundle
          ? templatesVersion
          : (existing?.templatesVersion ?? templatesVersion),
      });
    }
    const newLock: InstalledLock = {
      version: 2,
      harness: lock.harness,
      backlogBackend: lock.backlogBackend,
      versionScheme: lock.versionScheme,
      specBackend: lock.specBackend,
      specAutogen: lock.specAutogen,
      templatesVersion,
      entries: updatedEntries,
      // Persist the (possibly re-derived) decision so future upgrades read it
      // directly without re-walking the filesystem.
      ...(parentManaged ? { parentManaged: true as const } : {}),
    };
    await lockStore.write(input.projectDir, newLock);

    return {
      status: "applied",
      refusals,
      plan,
      fromVersion: lock.templatesVersion,
      toVersion: templatesVersion,
      backups: [...backupReport.backups, ...extraBackups]
        .filter((b) => b.wasSymlink !== true)
        .map((b) => b.dest),
      linksMoved: [...backupReport.backups, ...extraBackups]
        .filter((b) => b.wasSymlink === true)
        .map((b) => b.dest),
      managedSections: appliedSections,
      written: Object.keys(toWrite).sort(),
    };
  }

  /**
   * What the managed sections would need, without writing anything. A
   * destination that does not exist yet is not listed: the plan writes that
   * file whole, fences included.
   */
  private async surveyManagedSections(
    bundle: Bundle,
    projectDir: string,
    isDeclaredPreserved: (dest: string) => boolean,
  ): Promise<ManagedSectionOutcome[]> {
    const out: ManagedSectionOutcome[] = [];
    for (const [dest, label, body] of managedSectionEntries(bundle)) {
      if (isDeclaredPreserved(dest)) continue;
      const existing = await this.deps.reader.readText(projectDir, dest);
      if (existing === null) continue;
      const current = extractBlock(existing, label, "html");
      if (current === body) continue;
      out.push({ dest, label, kind: current === null ? "added" : "refreshed" });
    }
    return out;
  }

  /** Merges each managed section in, and reports only what actually changed. */
  private async applyManagedSections(
    bundle: Bundle,
    projectDir: string,
    isDeclaredPreserved: (dest: string) => boolean,
  ): Promise<ManagedSectionOutcome[]> {
    const out: ManagedSectionOutcome[] = [];
    for (const [dest, label, body] of managedSectionEntries(bundle)) {
      // A declared preserve wins over everything, `--force` included (spec 011
      // / #367, FR-009). #466 grafted its section straight off the bundle and
      // never consulted the predicate, so a file the maintainer had frozen was
      // written anyway — and the same run printed both "preserved … declared"
      // and "added the … section" for it. Only `--reset-preserved` lifts this,
      // and it does so by flipping the predicate in the handler.
      if (isDeclaredPreserved(dest)) continue;
      const existing = await this.deps.reader.readText(projectDir, dest);
      if (existing === null) continue;
      const current = extractBlock(existing, label, "html");
      if (current === body) continue;
      const merged = mergeIntoFile(existing, body, label, "html");
      if (merged === existing) continue;
      await this.deps.writer.writeBundle(
        { [dest]: { content: merged, executable: false } },
        projectDir,
        { overwrite: true, backupExisting: false },
      );
      out.push({ dest, label, kind: current === null ? "added" : "refreshed" });
    }
    return out;
  }
}

/**
 * Bundle entries declaring a managed section, as `[dest, label, body]`. The
 * body is the fenced region of the *bundled* template — an entry whose fences
 * are missing is dropped here, but it cannot reach a released binary:
 * `scripts/bundle-templates.ts` fails the build on that exact mismatch.
 */
function managedSectionEntries(bundle: Bundle): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [];
  for (const [dest, file] of Object.entries(bundle)) {
    // A destination may declare several labels (#576). Each is grafted
    // independently, so one being unfenced never silently suppresses another.
    for (const label of managedSectionLabels(file.managedSection)) {
      const body = extractBlock(file.content, label, "html");
      if (body === null || body.length === 0) continue;
      out.push([dest, label, body]);
    }
  }
  return out;
}

/**
 * The lock entry set for a project where every dest is `unchanged` (#572).
 *
 * Derived from the BUNDLE, not copied from the previous lock, so it applies the
 * same three rules the rebuild loop applies by iterating the same map: a dest
 * the bundle no longer carries is dropped, a `skipIfExists` dest the run did not
 * write is dropped, and everything else records the bundle's sha and the current
 * version. The early return used to copy `lock.entries` verbatim and skip all
 * three — harmless while that branch was near-unreachable, and not once
 * `staleVersion` made it the ordinary post-release path.
 *
 * `installedAt` is kept when the entry existed: the content matches the bundle,
 * but it did not arrive now, and trading a known date for a false one buys
 * nothing.
 */
function deriveUnchangedEntries(
  previous: ReadonlyMap<string, LockEntry>,
  newShas: Map<string, string>,
  bundle: Bundle,
  templatesVersion: string,
  now: string,
): Map<string, LockEntry> {
  const out = new Map<string, LockEntry>();
  for (const [dest, sha] of newShas) {
    const existing = previous.get(dest);
    // Same refusal as the rebuild loop, and it must be the SAME condition. The
    // first version added `existing === undefined`, which the rebuild loop does
    // not require: there, nothing is written on any dest this branch can see, so
    // a `skipIfExists` entry is dropped whether or not the lock already carried
    // it. Keeping it here meant the two builders disagreed on precisely the
    // input this helper exists to make them agree on — and the helper's version
    // re-stamped the user's own file with the bundle's sha, which is the
    // adoption the rebuild loop's comment refuses in as many words.
    if (bundle[dest]?.skipIfExists === true) continue;
    out.set(dest, {
      sha256: sha,
      installedAt: existing?.installedAt ?? now,
      templatesVersion,
    });
  }
  return out;
}

async function shaOfBundle(file: TemplateFile | undefined): Promise<string> {
  if (!file) return "";
  // Mirror init_project's hash logic: mergeBlock files are hashed on the
  // *block body* only, not the full file. Keeping these two paths in
  // lockstep is critical — a divergence here is what caused #163's
  // false-positive "customized" reports on `.gitignore` upgrades.
  const shaInput = file.mergeBlock !== undefined ? canonicalBlockBody(file.content) : file.content;
  return await sha256Hex(shaInput);
}
