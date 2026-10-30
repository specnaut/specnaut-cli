import type { BackupReport, ContextLinkWrite } from "./ports.ts";
import type { Bundle } from "../domain/template.ts";
import type { UpgradeAction, UpgradePlan } from "../domain/upgrade_plan.ts";
import { lockWith, rebuildEntries } from "./upgrade_lock.ts";
import { applyManagedSections } from "./upgrade_managed_sections.ts";
import { planStaging, pruneStaging } from "./upgrade_staging.ts";
import { removeOrphans } from "./upgrade_orphan_removal.ts";
import { applyContextLinks } from "./upgrade_context_links.ts";
import { reMergeJsonFiles } from "./upgrade_json_merges.ts";
import type { AppliedResult, UpgradeIo, UpgradeRun } from "./upgrade_run.ts";

type Backups = BackupReport["backups"];

/**
 * Carry out a plan that has file work, in the order each step's outcome
 * depends on: the bundle writes and links, the JSON re-merge, the staging
 * prune, the managed sections, the deletes, and the lock last — it records
 * what the other steps did, not what the plan forecast.
 */
export async function applyUpgrade(io: UpgradeIo, run: UpgradeRun): Promise<AppliedResult> {
  const written = await writePlanned(io, run);
  const merges = await reMergeJsonFiles(io.writer, run.jsonMerged, run.projectDir);
  // What this run staged is the whole of what is pending. Everything else in
  // the staging tree predates it — see `pruneStaging` (#477, #613).
  const pruned = await pruneStaging(io.stagingStore, run.projectDir, written.staged);
  // Applied *after* the plan's writes: an `auto-update` may just have
  // rewritten the whole file from the bundle, in which case the section is
  // already there and the merge is a no-op. Re-reading is what keeps the
  // reported outcome honest instead of echoing back what we predicted.
  const appliedSections = await applyManagedSections(
    io,
    run.bundle,
    run.projectDir,
    run.isDeclaredPreserved,
  );
  const deleted = await deletePlanned(io, run);
  const updatedEntries = await rebuildEntries({
    plan: run.plan,
    lock: run.effectiveLock,
    newShas: run.newShas,
    bundle: run.bundle,
    written: written.bundle,
    templatesVersion: run.templatesVersion,
    now: run.now,
    force: run.force,
  });
  // Persists the (possibly re-derived) parent-managed decision, so future
  // upgrades read it directly without re-walking the filesystem.
  const newLock = lockWith(run.lock, run.templatesVersion, updatedEntries, run.parentManaged);
  await io.lockStore.write(run.projectDir, newLock);
  const backups = [...written.backups, ...deleted.backups];
  return {
    status: "applied",
    refusals: [...run.refusals, ...pruned, ...deleted.refusals],
    plan: deleted.plan,
    fromVersion: run.lock.templatesVersion,
    toVersion: run.templatesVersion,
    backups: backups.filter((b) => b.wasSymlink !== true).map((b) => b.dest),
    linksMoved: backups.filter((b) => b.wasSymlink === true).map((b) => b.dest),
    contextLinks: written.links,
    managedSections: appliedSections,
    written: Object.keys(written.bundle).sort(),
    notes: [...run.links.notes, ...merges.notes],
    mergedChanged: merges.changed,
  };
}

/**
 * A declared-preserve (spec 011 / issue #367) is immune to `--force`: the
 * maintainer overrides it only via `--reset-preserved` (which flips the
 * predicate off, so the file never reaches here as reason:"declared"). Only a
 * `customized` preserve is overwritten by `--force`.
 */
const forceWritable = (force: boolean) => (a: UpgradeAction): boolean =>
  a.kind === "preserve" && a.reason === "customized" && force;

/**
 * Stage the upstream copy of each preserved file, then write every dest the
 * plan updates or adds (or `--force` overwrites), then the context links.
 * Returns what was written, what was staged, and what each write backed up.
 */
async function writePlanned(
  io: UpgradeIo,
  run: UpgradeRun,
): Promise<{ bundle: Bundle; staged: Set<string>; backups: Backups; links: ContextLinkWrite[] }> {
  const isForceWritablePreserve = forceWritable(run.force);
  // Staged so `specnaut reconcile` can act on the preserved files later.
  const staging = planStaging(
    run.plan,
    run.bundle,
    run.effectiveLock.entries,
    isForceWritablePreserve,
  );
  if (Object.keys(staging.writes).length > 0) {
    await io.writer.writeBundle(staging.writes, run.projectDir, {
      overwrite: true,
      backupExisting: false,
    });
  }
  const toWrite = bundleToWrite(run.plan, run.bundle, isForceWritablePreserve);
  // `--reset-baseline` overwrites from the bundle exactly like `--force` does,
  // so it owes the same `.specnaut.bak` (#519). It re-baselines before the plan
  // is computed, so every file it touches arrives here as `auto-update` rather
  // than a forced `preserve` — keyed on `force` alone, the backup never ran, and
  // the safer-looking option was the destructive one.
  const report = await io.writer.writeBundle(toWrite, run.projectDir, {
    overwrite: true,
    backupExisting: run.force || run.resetBaseline,
  });
  const relinked = await applyContextLinks(io.writer, run.plan, run.bundle, run.projectDir);
  return {
    bundle: { ...toWrite, ...relinked.written },
    staged: staging.staged,
    backups: [...report.backups, ...relinked.report.backups],
    links: [...(report.links ?? []), ...(relinked.report.links ?? [])],
  };
}

/** The bundle files the plan writes: updates, additions, and forced preserves. */
function bundleToWrite(
  plan: UpgradePlan,
  bundle: Bundle,
  isForceWritablePreserve: (a: UpgradeAction) => boolean,
): Bundle {
  const toWrite: Bundle = {};
  for (const action of plan) {
    if (
      action.kind === "auto-update" || action.kind === "add-new" ||
      isForceWritablePreserve(action)
    ) {
      const file = bundle[action.dest];
      if (file) toWrite[action.dest] = file;
    }
  }
  return toWrite;
}

/**
 * The plan's deletes: the orphans `removeOrphans` takes, then the plugin
 * migrations — a vanilla file the installed plugin now serves is backed up and
 * deleted. Always backed up: the on-disk copy is exactly what the plugin will
 * serve, but the user may want it back if they uninstall the plugin.
 */
async function deletePlanned(
  io: UpgradeIo,
  run: UpgradeRun,
): Promise<{ plan: UpgradePlan; backups: Backups; refusals: string[] }> {
  const removal = await removeOrphans(io.writer, run.plan, run.projectDir, run.force, run.harness);
  const migrations = run.plan.flatMap((a) => a.kind === "migrate-to-plugin" ? [a.dest] : []);
  if (migrations.length === 0) return removal;
  const r = await io.writer.deletePaths(migrations, run.projectDir, { backupExisting: true });
  return { ...removal, backups: [...removal.backups, ...r.backups] };
}
