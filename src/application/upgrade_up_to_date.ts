import type { InstalledLock } from "../domain/installed_lock.ts";
import { pruneAgenticEntries } from "../domain/parent_managed.ts";
import { deriveUnchangedEntries, isLockStale, lockWith } from "./upgrade_lock.ts";
import { reMergeJsonFiles } from "./upgrade_json_merges.ts";
import { pruneStaging } from "./upgrade_staging.ts";
import { productOwnerGrantNotices } from "./upgrade_seat_grant_notice.ts";
import type { UpgradeIo, UpgradeRun, UpToDateResult } from "./upgrade_run.ts";

/**
 * The run with no file work to do: every dest `unchanged`, no managed section
 * pending.
 *
 * The lock may still be behind, and this is where it is repaired — the applied
 * path's rebuild never sees a run that returns here (#572). A legacy lock whose
 * `parent_managed` differs from the decision just computed needs the field
 * persisted, or a handler-derived override never reaches disk until an
 * unrelated file change forces a rewrite (FR-007). This is a metadata-only
 * write; the common case, a lock that already says everything, writes nothing.
 *
 * NOT on a dry run: the version clause fires on the ordinary post-release state
 * (files current, version string behind), so a preview would otherwise mutate
 * the trust artefact on a perfectly normal tree. A preview that writes is not a
 * preview. The JSON re-merge and the staging prune are skipped for the same
 * reason; on a real run they still happen here, because a project already on
 * the current release reaches its next upgrade through this branch (#613).
 */
export async function finishUpToDate(io: UpgradeIo, run: UpgradeRun): Promise<UpToDateResult> {
  const corrected = repairedLock(run);
  if (corrected !== null && !run.dryRun) {
    await io.lockStore.write(run.projectDir, corrected);
  }
  const merges = run.dryRun
    ? { notes: [], changed: [] }
    : await reMergeJsonFiles(io.writer, run.jsonMerged, run.projectDir);
  // Every dest equals the bundle, so no staged copy has anything left to reconcile.
  const pruned = run.dryRun ? [] : await pruneStaging(io.stagingStore, run.projectDir, new Set());
  const grants = run.dryRun ? [] : await productOwnerGrantNotices(io.reader, run.projectDir);
  // The version reported is the one now recorded, not the one that was.
  return {
    status: "up-to-date",
    fromVersion: run.lock.templatesVersion,
    currentVersion: run.templatesVersion,
    refusals: [...run.refusals, ...pruned],
    notes: [...merges.notes, ...grants],
    mergedChanged: merges.changed,
  };
}

/**
 * The lock this run should record, or `null` when the current one is not stale
 * (`isLockStale`).
 *
 * Every dest is `unchanged`, so the entry set is fully derivable: a stale entry
 * is not ambiguous, because `unchanged` means the file equals the bundle and
 * the bundle's sha is what it should have said all along. Built from
 * `newShas`, not the lock's entries, so an orphan row the bundle no longer
 * contains is dropped (`deriveUnchangedEntries`).
 */
function repairedLock(run: UpgradeRun): InstalledLock | null {
  const { lock, effectiveLock, templatesVersion, parentManaged } = run;
  const entries = deriveUnchangedEntries(
    effectiveLock.entries,
    run.newShas,
    run.bundle,
    templatesVersion,
    run.now,
  );
  if (!isLockStale(effectiveLock, entries, { templatesVersion, parentManaged })) return null;
  return lockWith(
    lock,
    templatesVersion,
    parentManaged ? pruneAgenticEntries(entries) : entries,
    parentManaged,
  );
}
