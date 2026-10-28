import type {
  ContextLinkWrite,
  FsReader,
  FsWriter,
  Harness,
  LockStore,
  PluginDetector,
  StagingStore,
} from "./ports.ts";
import { type Bundle, lockShaInput } from "../domain/template.ts";
import { sha256Hex } from "../domain/sha256.ts";
import type { InstalledLock } from "../domain/installed_lock.ts";
import type { CoreBundle } from "../domain/core_bundle.ts";
import {
  computeUpgradePlan,
  type UpgradeAction,
  type UpgradePlan,
} from "../domain/upgrade_plan.ts";
import { extractBlock, mergeRefusal } from "../domain/merge_block.ts";
import { isPluginCoveredPath, pluginRelativePath } from "../domain/plugin_coverage.ts";
import { isAgenticPath, pruneAgenticEntries } from "../domain/parent_managed.ts";
import { deletesOrphan } from "../domain/orphan_scope.ts";
import { deriveUnchangedEntries, rebuildEntries } from "./upgrade_lock.ts";
import {
  applyManagedSections,
  type ManagedSectionOutcome,
  surveyManagedSections,
} from "./upgrade_managed_sections.ts";
import { planStaging, pruneStaging } from "./upgrade_staging.ts";
import { removeOrphans } from "./upgrade_orphan_removal.ts";
import { carryRenamedDocs } from "./upgrade_renames.ts";
import { surveyContextLinks } from "./upgrade_context_links.ts";

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

export type { ManagedSectionOutcome };

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
    /** What the settings merge changed that the person should hear about (#642). */
    notes: ReadonlyArray<string>;
    /** The context links this run wrote, and in which form (cli#680). */
    contextLinks: ReadonlyArray<ContextLinkWrite>;
  };

export type UpgradeProjectDeps = {
  reader: FsReader;
  writer: FsWriter;
  lockStore: LockStore;
  /**
   * `.specnaut/upgrade-staging/`. Required, not optional like the plugin probe:
   * an upgrade that cannot see the staging tree cannot prune it, and a prune
   * that silently does not happen is the #613 bug itself.
   */
  stagingStore: StagingStore;
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

    // Context links are classified by what `lstat` sees (cli#680); an inverted
    // consolidation is refused like the merges above, for the same reason.
    const links = await surveyContextLinks(
      reader,
      input.projectDir,
      bundle,
      lock,
      input.isDeclaredPreserved ?? (() => false),
    );
    for (const { dest, message } of links.refused) {
      refusals.push(message);
      delete bundle[dest];
      refusedDests.add(dest);
    }

    const destPaths = new Set<string>([
      ...Object.keys(bundle),
      ...lock.entries.keys(),
    ]);
    const diskShas = new Map<string, string>(links.diskShas);
    for (const dest of destPaths) {
      // Never read through a link: that is `AGENTS.md`, or outside the project.
      if (bundle[dest]?.symlinkTo !== undefined || refusedDests.has(dest)) continue;
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

    const effectiveLock = await carryRenamedDocs(
      {
        reader,
        writer,
        harness,
        bundleOpts: {
          backlogBackend: lock.backlogBackend,
          versionScheme: lock.versionScheme,
          specBackend: lock.specBackend,
          specAutogen: lock.specAutogen,
        },
        projectDir: input.projectDir,
        dryRun: input.dryRun,
        isDeclaredPreserved: input.isDeclaredPreserved,
      },
      bundle,
      lockForPlan,
      diskShas,
    );

    const newShas = new Map<string, string>();
    for (const [dest, file] of Object.entries(bundle)) {
      newShas.set(dest, await sha256Hex(lockShaInput(file)));
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
        managedRoots: harness.managedRoots,
        linkStates: links.states,
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
    const plannedSections = await surveyManagedSections(
      reader,
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
      deletesOrphan(a, input.force)
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
      // Every dest equals the bundle here, so no staged copy has anything left
      // to reconcile — and a project already on the current release reaches
      // its next upgrade through this branch, not the applied one (#613).
      if (!input.dryRun) {
        await pruneStaging(this.deps.stagingStore, input.projectDir, new Set(), refusals);
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
    const staging = planStaging(plan, bundle, effectiveLock.entries, isForceWritablePreserve);
    if (Object.keys(staging.writes).length > 0) {
      await writer.writeBundle(staging.writes, input.projectDir, {
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
    // Replacing what is not ours with a link ALWAYS keeps a backup (cli#680).
    const toRelink: Bundle = Object.fromEntries(
      plan.flatMap((a) => a.kind === "replace-with-link" ? [[a.dest, bundle[a.dest]]] : []),
    );
    const relinkReport = Object.keys(toRelink).length === 0
      ? { backups: [], skippedSkipIfExists: [] }
      : await writer.writeBundle(toRelink, input.projectDir, {
        overwrite: true,
        backupExisting: true,
      });
    const allWritten: Bundle = { ...toWrite, ...toRelink };

    // JSON-merged files are not part of the plan; re-graft the bundled
    // entries into whatever the user has on disk (idempotent — already-
    // present entries are skipped by the merge logic). Greenfield case
    // is handled too: writeBundle will just write the bundled content
    // when no file is present.
    let notes: ReadonlyArray<string> = links.notes;
    if (Object.keys(jsonMergedBundle).length > 0) {
      const merged = await writer.writeBundle(jsonMergedBundle, input.projectDir, {
        overwrite: true,
        backupExisting: false,
      });
      notes = [...notes, ...(merged.notes ?? [])];
    }

    // What this run staged is the whole of what is pending. Everything else in
    // the staging tree predates it — see `pruneStaging` (#477, #613).
    await pruneStaging(this.deps.stagingStore, input.projectDir, staging.staged, refusals);

    // Applied *after* the plan's writes: an `auto-update` may just have
    // rewritten the whole file from the bundle, in which case the section is
    // already there and the merge is a no-op. Re-reading is what keeps the
    // reported outcome honest instead of echoing back what we predicted.
    const appliedSections = await applyManagedSections(
      { reader, writer },
      bundle,
      input.projectDir,
      isDeclaredPreserved,
    );

    const removal = await removeOrphans(
      writer,
      plan,
      input.projectDir,
      input.force,
      harness.managedRoots,
      refusals,
    );
    let extraBackups = removal.backups;

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

    const updatedEntries = await rebuildEntries({
      plan,
      lock: effectiveLock,
      newShas,
      bundle,
      written: allWritten,
      templatesVersion,
      now: (this.deps.now ?? (() => new Date()))().toISOString(),
      force: input.force,
    });
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
      plan: removal.plan,
      fromVersion: lock.templatesVersion,
      toVersion: templatesVersion,
      backups: [...backupReport.backups, ...relinkReport.backups, ...extraBackups]
        .filter((b) => b.wasSymlink !== true)
        .map((b) => b.dest),
      linksMoved: [...backupReport.backups, ...relinkReport.backups, ...extraBackups]
        .filter((b) => b.wasSymlink === true)
        .map((b) => b.dest),
      contextLinks: [...(backupReport.links ?? []), ...(relinkReport.links ?? [])],
      managedSections: appliedSections,
      written: Object.keys(allWritten).sort(),
      notes,
    };
  }
}
