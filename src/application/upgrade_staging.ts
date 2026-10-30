import type { StagingStore } from "./ports.ts";
import type { Bundle } from "../domain/template.ts";
import type { LockEntry } from "../domain/installed_lock.ts";
import type { UpgradeAction, UpgradePlan } from "../domain/upgrade_plan.ts";
import { PathRefusal } from "../domain/path_refusal.ts";

/**
 * `.specnaut/upgrade-staging/` as `upgrade` fills and empties it: the upstream
 * copy of every customized file a run preserved, so `specnaut reconcile` can
 * act on it later, and nothing else.
 */

/**
 * The staging writes for this plan, and the dests they stage.
 *
 * @param isForceWritablePreserve the run's own predicate for a preserve that
 *   `--force` is about to overwrite — passed in, never re-derived, so staging
 *   and writing cannot disagree on which preserves those are.
 */
export function planStaging(
  plan: UpgradePlan,
  bundle: Bundle,
  lockEntries: ReadonlyMap<string, LockEntry>,
  isForceWritablePreserve: (a: UpgradeAction) => boolean,
): { writes: Bundle; staged: Set<string> } {
  const writes: Bundle = {};
  const staged = new Set<string>();
  for (const action of plan) {
    // Stage only `customized` preserves for reconcile; a declared-preserve is
    // a deliberate freeze, not a pending reconciliation.
    if (action.kind !== "preserve" || action.reason !== "customized") continue;
    // Nor one `--force` is about to overwrite: its destination becomes the
    // upstream a few lines down, so the copy would be stale on arrival (#477).
    if (isForceWritablePreserve(action)) continue;
    // And only if the lock can speak for it. `ReconcilePathUseCase` answers
    // `no-lock-entry` for a dest the lock does not carry, so staging one
    // produces a path `reconcile --status` lists forever and
    // `reconcile <path>` refuses — a pending item no command can clear.
    // Since #572 an unwritten preserve with no prior entry deliberately gets
    // no entry, which is exactly the population that would strand here.
    if (!lockEntries.has(action.dest)) continue;
    const file = bundle[action.dest];
    if (!file) continue;
    writes[`.specnaut/upgrade-staging/${action.dest}`] = file;
    staged.add(action.dest);
  }
  return { writes, staged };
}

/**
 * Delete every staged copy except the ones this run just staged.
 *
 * Staging exists so `reconcile` can offer the upstream version of a file an
 * upgrade refused to touch. After an applied upgrade the only such files are
 * the ones THIS run preserved, and it has just restaged each of them with the
 * current upstream. Any other copy in the tree is from an older release:
 *
 * - its dest was written by this run — the destination IS the upstream now,
 *   so there is nothing to reconcile (#477: 23 of 46 pending paths were
 *   byte-identical to their staged copy);
 * - its dest already equals the bundle (`unchanged`) — `--accept-upstream`
 *   would roll it back to the OLDER upstream;
 * - its dest left the bundle (retired, handed to the plugin, `remove`d) or
 *   was never tracked (`skipIfExists`) — `reconcile <path>` refuses it as
 *   "not tracked by Specnaut", so it sat in `--status` forever and kept the
 *   review marker from ever being retired (#613).
 *
 * Pruned without a backup, like #477's pruning before it: a staged copy is
 * upstream content Specnaut wrote, never the user's. Every run already
 * overwrites a restaged copy in place, and the review walk's merge option
 * edits the DESTINATION, not the copy. The user's bytes live at the dest,
 * which this never touches.
 *
 * Tree-driven rather than plan-driven on purpose: the paths that strand are
 * precisely the ones no current plan, bundle or lock mentions any more.
 *
 * Best-effort: this is housekeeping, and it runs before the managed sections
 * and the lock write. A delete that throws (a Windows file lock, a permission
 * bit) is reported through `refusals` and the upgrade finishes; letting it
 * propagate would leave the project half-upgraded over a copy nobody needs.
 * A containment refusal is reported in its own words (`leftAlone`).
 */
export async function pruneStaging(
  stagingStore: StagingStore,
  projectDir: string,
  keep: ReadonlySet<string>,
  refusals: string[],
): Promise<void> {
  for (const rel of await stagingStore.list(projectDir)) {
    if (keep.has(rel)) continue;
    try {
      await stagingStore.delete(projectDir, rel);
    } catch (err) {
      const path = `.specnaut/upgrade-staging/${rel}`;
      refusals.push(refusalLine(path, err, `could not clear the stale staged copy ${path}`));
    }
  }
  try {
    await stagingStore.cleanupIfEmpty(projectDir);
  } catch (err) {
    // An empty directory left behind is harmless and the next run retries —
    // but it is said, not swallowed: a catch that reports nothing would hide
    // the next failure here that is not harmless.
    const path = ".specnaut/upgrade-staging/";
    refusals.push(refusalLine(path, err, `could not remove the empty ${path}`));
  }
}

const why = (err: unknown) => err instanceof Error ? err.message : String(err);

/** A refused path names the link (`leftAlone`); any other failure is safe to clear by hand. */
const refusalLine = (path: string, err: unknown, failed: string) =>
  err instanceof PathRefusal
    ? leftAlone(path, err)
    : `${failed} (${why(err)}) — it is safe to delete by hand`;

/**
 * A staged path the adapter refused (cli#687) is not a stale copy: it is a link,
 * or sits behind one, leading out of the project or round a cycle. "Safe to
 * delete by hand" would invite deleting what it points at — a file Specnaut
 * never wrote — so the advice names the link.
 */
const leftAlone = (path: string, err: PathRefusal) =>
  `left ${path} in place — ${err.message}\n` +
  `It is not a plain staged copy: check where that link points, then remove the link ` +
  `itself, never what it points at.`;
