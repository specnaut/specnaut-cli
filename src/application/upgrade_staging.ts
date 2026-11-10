import type { StagingStore } from "./ports.ts";
import type { Bundle } from "../domain/template.ts";
import type { LockEntry } from "../domain/installed_lock.ts";
import type { UpgradeAction, UpgradePlan } from "../domain/upgrade_plan.ts";
import { PathRefusal } from "./path_refusal.ts";

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
 * bit) is returned as a refusal line and the upgrade finishes; letting it
 * propagate would leave the project half-upgraded over a copy nobody needs.
 * A containment refusal is reported in its own words (`leftAlone`), and a folder
 * the copy left behind in the store's: the copy is gone, so nothing there is to
 * delete by hand.
 *
 * The listing is best-effort too (cli#753): a tree it cannot read is one line,
 * nothing is deleted, and the next run retries (`listStaged`). The one
 * deliberate abort is a staging folder reached through a link: the store's
 * `PathRefusal` propagates, because what it would list is the link's target.
 */
export async function pruneStaging(
  stagingStore: StagingStore,
  projectDir: string,
  keep: ReadonlySet<string>,
): Promise<string[]> {
  const listed = await listStaged(stagingStore, projectDir);
  if (typeof listed === "string") return [listed];
  const refusals: string[] = [];
  for (const rel of listed) {
    if (keep.has(rel)) continue;
    try {
      refusals.push(...await stagingStore.delete(projectDir, rel));
    } catch (err) {
      const path = `.specnaut/upgrade-staging/${rel}`;
      refusals.push(refusalLine(path, err, `could not clear the stale staged copy ${path}`));
    }
  }
  const tidy = await tidyStagingRoot(stagingStore, projectDir);
  return tidy === null ? refusals : [...refusals, tidy];
}

/**
 * The staged paths, or the line to report when the tree cannot be listed (cli#753).
 *
 * The type is the test, as in `refusalLine`: a `PathRefusal` (a staging folder
 * reached through a link) is rethrown, and every other error, whichever errno
 * the system picked, becomes the line. No "safe to delete by hand": a listing
 * that failed cannot say what is there. The tidy is skipped with the deletes,
 * since a second line would only repeat that the folder cannot be read.
 */
async function listStaged(
  stagingStore: StagingStore,
  projectDir: string,
): Promise<string[] | string> {
  try {
    return await stagingStore.list(projectDir);
  } catch (err) {
    if (err instanceof PathRefusal) throw err;
    return `could not list .specnaut/upgrade-staging/ (${why(err)}); ` +
      `its stale copies stay until the next run`;
  }
}

/**
 * Removes the staging folder if nothing is left in it, the one tidy `pruneStaging`
 * and `reconcile` share. Returns the line to report when it could not, else `null`.
 *
 * A folder left behind is harmless and the next run retries, but it is said, not
 * swallowed: a catch that reports nothing would hide the next failure here that is
 * not harmless. No "safe to delete by hand": the failed read cannot say the folder
 * is empty, and it may still hold copies waiting to be reconciled.
 */
export async function tidyStagingRoot(
  stagingStore: StagingStore,
  projectDir: string,
): Promise<string | null> {
  try {
    await stagingStore.cleanupIfEmpty(projectDir);
    return null;
  } catch (err) {
    const path = ".specnaut/upgrade-staging/";
    return err instanceof PathRefusal
      ? leftAlone(path, err)
      : `could not tidy ${path} (${why(err)}); the next run retries`;
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
