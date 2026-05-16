/**
 * The `.specflow/upgrade-pending.json` marker. Written by `specflow upgrade`
 * on successful apply; consumed by `specflow-expert review-upgrade`.
 *
 * The marker is intentionally minimal. The list of preserved files is NOT
 * carried here — `specflow reconcile --status` inspects the staging directory
 * (`.specflow/upgrade-staging/`) directly, which is the live source of truth.
 */
export type UpgradeMarker = {
  /** Version the user was on BEFORE the (chain of) upgrade(s). */
  readonly from: string;
  /** Version the user is on AFTER the latest upgrade. */
  readonly to: string;
  /** ISO-8601 timestamp of the latest upgrade. */
  readonly at: string;
};

/**
 * Merge a new upgrade event into an existing marker (or write fresh when
 * none exists).
 *
 * The key invariant: when the user upgrades twice without reconciling,
 * the original `from` is preserved so the eventual review covers the
 * whole range. `to` and `at` always reflect the latest upgrade.
 */
export function mergeMarker(
  existing: UpgradeMarker | null,
  fresh: UpgradeMarker,
): UpgradeMarker {
  if (existing === null) return fresh;
  return {
    from: existing.from,
    to: fresh.to,
    at: fresh.at,
  };
}
