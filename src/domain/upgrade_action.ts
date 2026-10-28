import type { RefusedScope } from "./orphan_scope.ts";

/**
 * The vocabulary of an upgrade plan: one action per destination, as
 * `computeUpgradePlan` decides it and every consumer — the use case, the
 * summary, the lock rebuild — reads it.
 */
export type UpgradeAction =
  | { kind: "auto-update"; dest: string; oldSha: string; newSha: string }
  | {
    kind: "preserve";
    dest: string;
    /**
     * Why the file is preserved:
     *   - `"customized"`: the on-disk SHA diverges from the lock (the
     *     maintainer edited it) — the existing implicit auto-preserve.
     *   - `"declared"`: the maintainer listed the path in
     *     `.specnaut/preserve.yml` (spec 011 / issue #367). A declared
     *     file is preserved regardless of its SHA and wins over
     *     auto-update, plugin-migration, and removal.
     */
    reason: "customized" | "declared";
    /**
     * True when the `specnaut-plugin` plugin owns this path AND the
     * plugin is installed on the host. The handler surfaces an extra
     * warn line in this case ("plugin version is also available;
     * reconcile manually or pass --force"); the file content stays
     * untouched either way.
     */
    pluginAvailable: boolean;
    /**
     * Set when this file is **both** customized and behind upstream — the
     * state that rots silently.
     *
     * Preserving a customized file is correct, but the lock entry is frozen
     * along with it (`upgrade_project.ts`: `wrote` is false, so `sha256` and
     * `templatesVersion` carry over verbatim). Every later run therefore
     * reaches the same verdict and skips again, forever, while the summary
     * says only "customized locally" — which reads as a settled fact rather
     * than as an update that never arrived.
     *
     * The frozen field is what makes the gap reportable: it still holds the
     * version that last wrote the file. Re-stamping it to "heal" the freeze
     * would destroy the only record of when the divergence began, so this
     * reads the freeze rather than repairing it.
     *
     * Absent when the file is customized but upstream has not moved since —
     * nothing was missed there, and warning about it would be noise.
     */
    staleSince?: { templatesVersion: string; installedAt: string };
    /**
     * Only set for `reason: "declared"`, and the whole point of setting it.
     *
     * A declaration in `preserve.yml` does more than beat `--force`: it takes
     * the path off every surface that reports drift. It never becomes a
     * `customized` preserve, so `upgrade_project.ts` never stages it and
     * `reconcile --status` cannot list it. That is deliberate — a freeze is
     * not a pending reconciliation — but it left NOTHING saying a frozen copy
     * had fallen behind, which is how a shared helper added upstream can be
     * missing from a preserved script while every run reports success.
     *
     *   - `"current"`         the bundle still matches the recorded SHA.
     *   - `"behind"`          upstream moved since the freeze. `staleSince`
     *                         carries the freeze point, decided by the SAME
     *                         predicate the `customized` bucket uses so the
     *                         two cannot part company.
     *   - `"no-lock-entry"`   nothing recorded to compare against. Not
     *                         "current": that would be a claim the data
     *                         cannot support.
     *   - `"dropped-upstream"` the bundle no longer ships this path, so
     *                         "behind" is not a question that has an answer.
     */
    declaredDrift?: "current" | "behind" | "no-lock-entry" | "dropped-upstream";
    /**
     * The freeze point for a declared preserve reported as `"behind"`, and the
     * reason this is NOT `staleSince`.
     *
     * `staleSince` means "an update was published and never applied" — an
     * accident, with `--reset-baseline` as its remedy and the whole
     * `customized, and behind` block as its report. A declared preserve is
     * none of that: the maintainer instructed the freeze, and telling them
     * their own instruction went wrong is what the existing assertion
     * `a declared preserve is never flagged as behind` correctly forbids.
     *
     * What that assertion cannot mean is that the maintainer must not be TOLD
     * upstream moved. `preserve.yml`'s own prose frames a declaration as a
     * maintenance obligation — entries carry conditions like "this line comes
     * out if upstream ships its own fix" — and an obligation with no
     * instrument is one nobody can discharge. So: same predicate, separate
     * field, separate report, and no remedy that lifts the freeze.
     */
    declaredFrozenAt?: { templatesVersion: string; installedAt: string };
  }
  | { kind: "add-new"; dest: string }
  | {
    /**
     * A context-link destination (cli#680, cli#681) holding something that is
     * not ours: the user's own file, or a link elsewhere. Replaced by the link,
     * ALWAYS with a backup, and named in the summary — a preserve would leave
     * the defect the link fixes live for exactly the users who edited it.
     */
    kind: "replace-with-link";
    dest: string;
    previous: "customized-file" | "foreign-link";
  }
  | { kind: "unchanged"; dest: string }
  | {
    kind: "migrate-to-plugin";
    dest: string;
    /** SHA of the file as it sits on disk today — backed up before deletion. */
    oldSha: string;
  }
  | {
    /**
     * Plugin-covered dest is missing on disk and the plugin is
     * installed: do nothing on the filesystem, just drop the lock
     * entry. The plugin will serve this file from now on.
     */
    kind: "defer-to-plugin";
    dest: string;
  }
  | { kind: "remove"; dest: string; oldSha: string; wasCustomized: boolean }
  /** cli#665: an orphan `upgrade` may not delete — reported, untracked, never touched. */
  | { kind: "orphan-refused"; dest: string; reason: RefusedScope; onDisk: boolean };

export type UpgradePlan = ReadonlyArray<UpgradeAction>;
