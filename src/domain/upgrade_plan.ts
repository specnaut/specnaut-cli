import type { InstalledLock } from "./installed_lock.ts";

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
     *     `.specflow/preserve.yml` (spec 011 / issue #367). A declared
     *     file is preserved regardless of its SHA and wins over
     *     auto-update, plugin-migration, and removal.
     */
    reason: "customized" | "declared";
    /**
     * True when the `specflow-plugin` plugin owns this path AND the
     * plugin is installed on the host. The handler surfaces an extra
     * warn line in this case ("plugin version is also available;
     * reconcile manually or pass --force"); the file content stays
     * untouched either way.
     */
    pluginAvailable: boolean;
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
  | { kind: "remove"; dest: string; oldSha: string; wasCustomized: boolean };

export type UpgradePlan = ReadonlyArray<UpgradeAction>;

/**
 * Compute the upgrade plan from three SHA256 snapshots:
 *   - `diskShas` : current content SHA of each file (absent = not on disk)
 *   - `lock`     : the .specflow/installed.lock
 *   - `newShas`  : SHA of each file in the binary's embedded templates
 *
 * Plus two parameters that drive the binary → plugin migration table:
 *   - `pluginInstalled`  : whether the `specflow-plugin` plugin is on
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
 * Emits one UpgradeAction per destination in the new bundle, plus a
 * `remove` action for each lock entry that is no longer in the new
 * bundle but is still on disk. Orphan entries that are not on disk
 * produce no action — the caller drops them from the new lock
 * implicitly by iterating only `newShas`.
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
   * (e.g. `AGENTS.md`, `.specflow/memory/constitution.md`) may exist on
   * disk before init touches them — in which case init deliberately
   * skips writing AND skips recording them in the lock. Without this
   * predicate, upgrade saw `diskSha defined + lockSha undefined` and
   * misclassified the user-owned file as "customized locally". With
   * the predicate, those files are silently omitted from the plan —
   * they were never specflow-managed.
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
   * `.specflow/preserve.yml` (spec 011 / issue #367). A declared path is
   * promoted to `preserve / reason:"declared"` as the FIRST branch of the
   * plan — it wins over unchanged, auto-update, plugin-migration, AND
   * removal (a declared path dropped upstream is kept on disk, FR-009).
   * Injected by the upgrade handler; the domain never reads the manifest.
   */
  isDeclaredPreserved?: (dest: string) => boolean;
};

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
    // the maintainer listed in .specflow/preserve.yml is kept regardless of
    // its SHA — before the unchanged, auto-update, and plugin-migration
    // branches. The file is only present here (in newShas) so `pluginAvailable`
    // is reported from coverage for the handler's reconcile hint.
    if (isDeclaredPreserved(dest)) {
      actions.push({
        kind: "preserve",
        dest,
        reason: "declared",
        pluginAvailable: pluginInstalled && isPluginCoveredFn(dest),
      });
      continue;
    }

    // Reset-baseline: if the on-disk content disagrees with the lock SHA,
    // trust the disk. This heals stale locks left by pre-v1.0 binaries
    // and is the migration path for the false-positive "customized"
    // bug (#163). Skipped when the lock genuinely has no entry — that
    // case still falls through to the skipIfExists / customized branch.
    if (resetBaseline && diskSha !== undefined && lockSha !== undefined && diskSha !== lockSha) {
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
      // skipIfExists files (AGENTS.md, .specflow/memory/constitution.md, …)
      // that the user already had at init time were deliberately not
      // tracked by the lock. They were never specflow-managed; do not
      // emit any action — silent skip prevents the false-positive
      // "customized locally" report (#163).
      if (isSkipIfExists(dest)) {
        continue;
      }
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
    });
  }

  // Orphans: lock entries not in newShas. Emit `remove` if still on disk.
  const orphanDests = [...lock.entries.keys()]
    .filter((dest) => !newShas.has(dest))
    .sort();
  for (const dest of orphanDests) {
    const diskSha = diskShas.get(dest);
    if (diskSha === undefined) continue;
    // FR-009: a declared path the bundle dropped is kept on disk
    // (preservation wins over removal), surfaced as preserve/declared.
    if (isDeclaredPreserved(dest)) {
      actions.push({
        kind: "preserve",
        dest,
        reason: "declared",
        pluginAvailable: pluginInstalled && isPluginCoveredFn(dest),
      });
      continue;
    }
    const lockSha = lock.entries.get(dest)!.sha256;
    actions.push({
      kind: "remove",
      dest,
      oldSha: lockSha,
      wasCustomized: diskSha !== lockSha,
    });
  }

  return actions;
}
