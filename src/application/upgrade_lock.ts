import { type Bundle, lockShaInput } from "../domain/template.ts";
import type { InstalledLock, LockEntry } from "../domain/installed_lock.ts";
import type { UpgradePlan } from "../domain/upgrade_plan.ts";
import { keptOrphanEntries } from "../domain/orphan_scope.ts";
import { sha256Hex } from "../domain/sha256.ts";

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
export function deriveUnchangedEntries(
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

/** What the rebuild of an applied upgrade's lock entries reads. */
export type RebuildInput = {
  readonly plan: UpgradePlan;
  /** The lock the plan was computed against, renames and refusals applied. */
  readonly lock: InstalledLock;
  readonly newShas: ReadonlyMap<string, string>;
  readonly bundle: Bundle;
  /** What this run wrote from the bundle. */
  readonly written: Bundle;
  readonly templatesVersion: string;
  readonly now: string;
  readonly force: boolean;
};

/**
 * The lock entries after an applied upgrade: one per bundle dest the binary
 * still owns, plus the orphans this run kept.
 *
 * Dests handed off to the plugin are dropped — the binary is no longer the
 * owner of those files. Every other dest is decided by `entryFor`.
 *
 * #572. A dest the plan classified `unchanged` has disk content that ALREADY
 * equals the bundle — that is the definition of the branch. Its lock entry was
 * nevertheless carried over verbatim, because `wrote` is false for anything
 * outside `toWrite`, so a project whose lock had fallen behind kept a sha
 * matching NEITHER the file NOR the bundle, forever. `upgrade` could not heal it
 * (nothing to write), and `--reset-baseline` could not either (it assigns a
 * local `lockSha` inside the planner and never reaches `lock.entries`). The
 * only remaining remedy was editing the lock by hand, which is the opposite of
 * what a lock is for.
 *
 * This is NOT the freeze the `staleSince` doc describes and deliberately leaves
 * alone. That one is about a **customized** preserve, where the frozen
 * `templatesVersion` is the only record of when the divergence began and
 * re-stamping would destroy it. Here there is no divergence to record: the
 * file and the bundle agree.
 */
export async function rebuildEntries(input: RebuildInput): Promise<Map<string, LockEntry>> {
  const { plan, lock, newShas } = input;
  const droppedToPlugin = new Set<string>(
    plan
      .filter((a) => a.kind === "migrate-to-plugin" || a.kind === "defer-to-plugin")
      .map((a) => a.dest),
  );
  const unchangedDests = new Set(
    plan.filter((a) => a.kind === "unchanged").map((a) => a.dest),
  );
  const updatedEntries = new Map<string, LockEntry>();
  for (const [dest] of newShas) {
    if (droppedToPlugin.has(dest)) continue;
    const entry = await entryFor(dest, input, unchangedDests);
    if (entry !== undefined) updatedEntries.set(dest, entry);
  }
  // cli#666: a customised orphan this run kept stays tracked — see `keptOrphanEntries`.
  for (const [d, e] of keptOrphanEntries(plan, lock, input.force)) {
    updatedEntries.set(d, e);
  }
  return updatedEntries;
}

/**
 * One bundle dest's lock entry after the run, or `undefined` for none.
 *
 * **A `skipIfExists` file the run did not write gets no entry.** The user
 * already had it, so it is theirs, and init deliberately left it out of the
 * lock. An upgrade that did not write it must not adopt it either: recording
 * the BUNDLE's sha against THEIR file makes every later upgrade report it as
 * "customized locally" and dump a full diff — and makes `--force` overwrite it.
 * That is the #163 false positive, arriving one run later through the lock
 * instead of through the plan. This drops a PRE-EXISTING entry too, and that is
 * the point. The guard used to require `existing === undefined`, so it only
 * ever prevented adoption on a clean lock — a project whose lock already
 * carried the dest (tracked by an older binary, or by a partial upgrade) kept
 * that entry forever, which is precisely what disarmed the plan-side guard.
 * Dropping it here heals the project on its next upgrade, without the user
 * needing to know the problem existed.
 *
 * **An unwritten dest with no prior entry, not matching the bundle, gets no
 * entry** — the same refusal, for the same reason, one branch over. The first
 * version of this fix recorded `diskShas.get(dest)` here. That was aimed at a
 * DECLARED preserve after a template rename, but nothing gated it on the
 * reason, so it fired for a `customized` preserve too — the `lockSha ===
 * undefined` branch, whose own comment reads "the user's own edit of a file
 * Specnaut manages". Recording the user's sha as the installed baseline makes
 * the NEXT run see `diskSha === lockSha`, classify the file `auto-update`, and
 * overwrite it — with no `.specnaut.bak`, because a plain upgrade passes
 * `backupExisting: false`. Two runs, no flag, no warning, and the edits are
 * gone. Recording nothing keeps the file exactly as untracked as it was, so
 * the next run reaches the same branch and preserves it again. The ticket's
 * own criterion allows "the disk sha OR no entry at all"; only one of the two
 * is safe for both reasons, so it is the one taken.
 *
 * **Otherwise**, a dest matching the bundle (written now, or `unchanged`)
 * records the bundle's sha and the current version; any other keeps its prior
 * entry's. `existing` is defined there whenever the dest does not match — the
 * guard returned for every other case — so no fallback sha is reachable and
 * none is offered. The old `?? sha` recorded the BUNDLE's sha against a file
 * the run refused to touch; its replacement recorded the user's, which was
 * worse. `installedAt` is NOT re-stamped for `unchanged`: the content matches
 * the bundle, but it did not arrive now — it arrived whenever it was last
 * written, and that is what the recorded value says. Overwriting it would trade
 * a known date for a false one and buy nothing: no consumer reads `installedAt`
 * to decide anything, and the one place it is read (`staleSince`) only fires on
 * customized preserves, which this branch never touches.
 */
async function entryFor(
  dest: string,
  input: RebuildInput,
  unchangedDests: ReadonlySet<string>,
): Promise<LockEntry | undefined> {
  const { lock, bundle, written, templatesVersion, now } = input;
  const existing = lock.entries.get(dest);
  const file = bundle[dest];
  const sha = file === undefined ? "" : await sha256Hex(lockShaInput(file));
  const wrote = written[dest] !== undefined;
  if (!wrote && file?.skipIfExists === true) return undefined;
  // True when the file on disk holds this bundle's content — either because
  // we just wrote it, or because it already did.
  const matchesBundle = wrote || unchangedDests.has(dest);
  if (!wrote && existing === undefined && !matchesBundle) return undefined;
  return {
    sha256: matchesBundle ? sha : existing?.sha256 ?? sha,
    installedAt: wrote ? now : (existing?.installedAt ?? now),
    templatesVersion: matchesBundle
      ? templatesVersion
      : (existing?.templatesVersion ?? templatesVersion),
  };
}
