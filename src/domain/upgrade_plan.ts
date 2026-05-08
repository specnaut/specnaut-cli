import type { InstalledLock } from "./installed_lock.ts";

export type UpgradeAction =
  | { kind: "auto-update"; dest: string; oldSha: string; newSha: string }
  | {
    kind: "preserve";
    dest: string;
    reason: "customized";
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
export function computeUpgradePlan(
  diskShas: Map<string, string>,
  lock: InstalledLock,
  newShas: Map<string, string>,
  pluginInstalled: boolean = false,
  isPluginCovered: (dest: string) => boolean = () => false,
): UpgradePlan {
  const actions: UpgradeAction[] = [];
  const sortedDests = [...newShas.keys()].sort();

  for (const dest of sortedDests) {
    const newSha = newShas.get(dest)!;
    const diskSha = diskShas.get(dest);
    const lockSha = lock.entries.get(dest)?.sha256;

    const covered = pluginInstalled && isPluginCovered(dest);

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
