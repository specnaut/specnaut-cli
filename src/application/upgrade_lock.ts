import type { Bundle } from "../domain/template.ts";
import type { LockEntry } from "../domain/installed_lock.ts";

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
