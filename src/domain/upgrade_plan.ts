import type { InstalledLock } from "./installed_lock.ts";
import { planOrphans, type RefusedScope } from "./orphan_scope.ts";

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

/**
 * Compute the upgrade plan from three SHA256 snapshots:
 *   - `diskShas` : current content SHA of each file (absent = not on disk)
 *   - `lock`     : the .specnaut/installed.lock
 *   - `newShas`  : SHA of each file in the binary's embedded templates
 *
 * Plus two parameters that drive the binary → plugin migration table:
 *   - `pluginInstalled`  : whether the `specnaut-plugin` plugin is on
 *                          the host (probed at use-case entry by the
 *                          `PluginDetector` port).
 *   - `isPluginCovered`  : predicate `(dest) => boolean` returning true
 *                          when the plugin owns a copy of `dest`. See
 *                          `plugin_coverage.ts` for the canonical map.
 *
 * Behavior on plugin-covered dests when the plugin is installed:
 *   - vanilla on disk (SHA matches lock) → `migrate-to-plugin` (the
 *     binary backs the file up, deletes the on-disk copy, and drops
 *     the lock entry; the plugin serves the file going forward).
 *   - customized on disk (SHA differs from lock) → `preserve` with
 *     `pluginAvailable: true` (handler surfaces the reconcile warning).
 *
 * For uncovered dests, or any dest when the plugin is not installed,
 * behavior is identical to before the migration table existed.
 *
 * Emits one UpgradeAction per destination in the new bundle, plus the
 * orphan actions `planOrphans` decides for each lock entry the bundle no
 * longer carries: `remove` when it may go and is still on disk, and
 * `orphan-refused` when it lies outside what `upgrade` may delete. An
 * in-scope orphan no longer on disk produces no action.
 */
/**
 * Optional inputs that didn't exist in the v1.0 plan signature. Carried as
 * a single object so future additions don't keep growing the positional
 * parameter list.
 */
export type UpgradePlanOptions = {
  pluginInstalled?: boolean;
  isPluginCovered?: (dest: string) => boolean;
  /**
   * Predicate identifying `skipIfExists` bundle entries. Such files
   * (e.g. `AGENTS.md`, `.specnaut/memory/constitution.md`) may exist on
   * disk before init touches them — in which case init deliberately
   * skips writing AND skips recording them in the lock. Without this
   * predicate, upgrade saw `diskSha defined + lockSha undefined` and
   * misclassified the user-owned file as "customized locally". With
   * the predicate, those files are silently omitted from the plan —
   * they were never specnaut-managed.
   */
  isSkipIfExists?: (dest: string) => boolean;
  /**
   * `--reset-baseline` mode. When true, files where `diskSha != lockSha`
   * have their lock SHA force-reset to the disk SHA before the plan is
   * computed. Net effect: stale locks (e.g. from a pre-v1.0 binary that
   * recorded the wrong SHA) get re-aligned with reality and the plan
   * compares disk against bundle directly. Risk: a user who genuinely
   * customised a file loses their edit signal. Document accordingly.
   */
  resetBaseline?: boolean;
  /**
   * True when the maintainer declared `dest` preserved in
   * `.specnaut/preserve.yml` (spec 011 / issue #367). A declared path is
   * promoted to `preserve / reason:"declared"` as the FIRST branch of the
   * plan — it wins over unchanged, auto-update, plugin-migration, AND
   * removal (a declared path dropped upstream is kept on disk, FR-009).
   * Injected by the upgrade handler; the domain never reads the manifest.
   */
  isDeclaredPreserved?: (dest: string) => boolean;
  /** `Harness.managedRoots`: bounds which orphans may be removed (`orphanScope`). */
  managedRoots?: ReadonlyArray<string>;
};

/**
 * Whether a customized file has also fallen behind upstream, and since when.
 *
 * Two conditions, and both are load-bearing:
 *
 *  - `lockSha !== newSha` — the template actually changed since this file was
 *    last written. Without it, a file the user edited whose template never
 *    moved would be reported as behind when nothing was missed.
 *  - `entry.templatesVersion !== lock.templatesVersion` — this entry never
 *    caught up. The lock's own version advances on every run, so an entry
 *    lagging it was skipped by at least one completed upgrade.
 *
 * Together they mean: an update was published for this path, and it never
 * landed. That is the state worth a warning; either alone is not.
 */
function staleSince(
  lock: InstalledLock,
  dest: string,
  lockSha: string,
  newSha: string,
): { staleSince: { templatesVersion: string; installedAt: string } } | null {
  if (lockSha === newSha) return null;
  const entry = lock.entries.get(dest);
  if (entry === undefined) return null;
  if (entry.templatesVersion === lock.templatesVersion) return null;
  return {
    staleSince: {
      templatesVersion: entry.templatesVersion,
      installedAt: entry.installedAt,
    },
  };
}

export function computeUpgradePlan(
  diskShas: Map<string, string>,
  lock: InstalledLock,
  newShas: Map<string, string>,
  pluginInstalledOrOpts: boolean | UpgradePlanOptions = false,
  isPluginCovered: (dest: string) => boolean = () => false,
): UpgradePlan {
  // Accept both legacy positional form (boolean + predicate) and the new
  // options-bag form. Existing callers and tests use the legacy shape.
  const opts: UpgradePlanOptions = typeof pluginInstalledOrOpts === "object"
    ? pluginInstalledOrOpts
    : { pluginInstalled: pluginInstalledOrOpts, isPluginCovered };
  const pluginInstalled = opts.pluginInstalled ?? false;
  const isPluginCoveredFn = opts.isPluginCovered ?? (() => false);
  const isSkipIfExists = opts.isSkipIfExists ?? (() => false);
  const resetBaseline = opts.resetBaseline ?? false;
  const isDeclaredPreserved = opts.isDeclaredPreserved ?? (() => false);
  const actions: UpgradeAction[] = [];
  const sortedDests = [...newShas.keys()].sort();

  for (const dest of sortedDests) {
    const newSha = newShas.get(dest)!;
    const diskSha = diskShas.get(dest);
    let lockSha = lock.entries.get(dest)?.sha256;

    // Declared-preserve wins over everything (spec 011 / issue #367): a path
    // the maintainer listed in .specnaut/preserve.yml is kept regardless of
    // its SHA — before the unchanged, auto-update, and plugin-migration
    // branches. The file is only present here (in newShas) so `pluginAvailable`
    // is reported from coverage for the handler's reconcile hint.
    if (isDeclaredPreserved(dest)) {
      // The declaration decides that the file is KEPT. It does not decide
      // that nothing has happened upstream, and this branch used to return
      // before anything asked. `staleSince` is reused rather than
      // reimplemented: one predicate answers "behind" for both preserve
      // reasons, so a later change to it cannot fix one and miss the other —
      // which is exactly how this population came to be missed in the first
      // place, by a repair applied only to the `customized` half.
      const declLockSha = lock.entries.get(dest)?.sha256;
      const stale = declLockSha === undefined ? null : staleSince(lock, dest, declLockSha, newSha);
      actions.push({
        kind: "preserve",
        dest,
        reason: "declared",
        pluginAvailable: pluginInstalled && isPluginCoveredFn(dest),
        declaredDrift: declLockSha === undefined
          ? "no-lock-entry"
          : stale !== null
          ? "behind"
          : "current",
        // Deliberately NOT `staleSince`: see `declaredFrozenAt` above. Same
        // predicate, different field, so nothing consuming `staleSince` —
        // the `customized, and behind` report and its --reset-baseline hint —
        // silently acquires a population it was never written for.
        ...(stale !== null ? { declaredFrozenAt: stale.staleSince } : {}),
      });
      continue;
    }

    // Reset-baseline: if the on-disk content disagrees with the lock SHA,
    // trust the disk. This heals stale locks left by pre-v1.0 binaries
    // and is the migration path for the false-positive "customized"
    // bug (#163). Skipped when the lock genuinely has no entry — that
    // case still falls through to the skipIfExists / customized branch.
    //
    // The bound is `staleSince` itself — the SAME predicate that decides what
    // the report lists under "customized, and behind", which is the list the
    // flag's own hint offers to apply ("All N at once"). Anything looser makes
    // that N a lie.
    //
    // It has been wrong in both directions. Originally the reset swept the
    // entire `customized` bucket, so a project with 2 behind and 111 merely
    // customized lost all 113 (#519). The fix bounded it to `lockSha !== newSha`
    // — upstream actually moved — which is only the FIRST of the two conditions
    // `staleSince` requires. On a same-minor upgrade the two agree and the gap
    // is invisible; across majors upstream has moved for nearly everything, and
    // a project audited going 1.14.1 → 3.1.2 measured 53 auto-updates against
    // the 2 its hint advertised.
    //
    // The #163 migration still passes through: a lock corrupted by a pre-v1.0
    // binary carries a SHA matching neither disk nor bundle, and its entry stops
    // advancing the moment the file is preserved, so it lags the lock's own
    // version and `staleSince` fires.
    if (
      resetBaseline && diskSha !== undefined && lockSha !== undefined &&
      diskSha !== lockSha && staleSince(lock, dest, lockSha, newSha) !== null
    ) {
      lockSha = diskSha;
    }

    const covered = pluginInstalled && isPluginCoveredFn(dest);

    if (diskSha === undefined) {
      // File missing on disk. Plugin-covered + plugin installed:
      // defer to the plugin (drop lock entry, don't re-add). Otherwise,
      // re-add from the bundle.
      actions.push(
        covered ? { kind: "defer-to-plugin", dest } : { kind: "add-new", dest },
      );
      continue;
    }

    // A `skipIfExists` dest that is present on disk belongs to the user, not
    // to Specnaut — `AGENTS.md` and the constitution are written once, at
    // init, and are the project's own thereafter. Full-writing one is never
    // correct, so this guard sits above every write branch and is independent
    // of the lock.
    //
    // It used to live inside the `lockSha === undefined` branch below, which
    // made the protection self-disarming: any binary that once tracked the
    // dest — before it was declared `skipIfExists`, or during a partial
    // upgrade that got one file in — left an entry behind, and from then on
    // the guard never fired for that project again. The file fell through to
    // `auto-update` and was overwritten wholesale by a plain `upgrade`: no
    // `--force`, no "preserved" line, no warning. The protection held for
    // fresh installs and failed for exactly the long-lived ones carrying user
    // content worth protecting.
    //
    // The one section Specnaut does own inside these files still reaches the
    // project: `managedSection` merges are surveyed outside the plan.
    if (isSkipIfExists(dest)) continue;

    // Vanilla = SHA matches lock entry. With plugin installed and
    // covered, hand the file off to the plugin regardless of whether
    // the new bundle's SHA matches.
    const isVanilla = lockSha !== undefined && diskSha === lockSha;
    if (covered && isVanilla) {
      actions.push({ kind: "migrate-to-plugin", dest, oldSha: diskSha });
      continue;
    }

    if (diskSha === newSha) {
      actions.push({ kind: "unchanged", dest });
      continue;
    }
    if (lockSha === undefined) {
      // Untracked and diverged from the bundle: the user's own edit of a file
      // Specnaut manages. (`skipIfExists` dests never reach here — they are
      // skipped above, whatever the lock says.)
      actions.push({
        kind: "preserve",
        dest,
        reason: "customized",
        pluginAvailable: covered,
      });
      continue;
    }
    if (diskSha === lockSha) {
      actions.push({ kind: "auto-update", dest, oldSha: lockSha, newSha });
      continue;
    }
    actions.push({
      kind: "preserve",
      dest,
      reason: "customized",
      pluginAvailable: covered,
      ...(staleSince(lock, dest, lockSha, newSha) ?? {}),
    });
  }

  // Orphans: lock entries the bundle no longer carries — see `planOrphans`.
  actions.push(...planOrphans(diskShas, lock, newShas, {
    managedRoots: opts.managedRoots,
    isDeclaredPreserved,
    pluginAvailable: (dest) => pluginInstalled && isPluginCoveredFn(dest),
  }));

  return actions;
}
