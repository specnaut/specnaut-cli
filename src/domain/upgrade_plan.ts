import type { InstalledLock } from "./installed_lock.ts";

export type UpgradeAction =
  | { kind: "auto-update"; dest: string; oldSha: string; newSha: string }
  | { kind: "preserve"; dest: string; reason: "customized" }
  | { kind: "add-new"; dest: string }
  | { kind: "unchanged"; dest: string }
  | { kind: "remove"; dest: string; oldSha: string; wasCustomized: boolean };

export type UpgradePlan = ReadonlyArray<UpgradeAction>;

/**
 * Compute the upgrade plan from three SHA256 snapshots:
 *   - `diskShas` : current content SHA of each file (absent = not on disk)
 *   - `lock`     : the .specflow/installed.lock
 *   - `newShas`  : SHA of each file in the binary's embedded templates
 *
 * Emits one UpgradeAction per destination in the new bundle, plus a `remove`
 * action for each lock entry that is no longer in the new bundle but is
 * still on disk. Orphan entries that are not on disk produce no action — the
 * caller drops them from the new lock implicitly by iterating only `newShas`.
 */
export function computeUpgradePlan(
  diskShas: Map<string, string>,
  lock: InstalledLock,
  newShas: Map<string, string>,
): UpgradePlan {
  const actions: UpgradeAction[] = [];
  const sortedDests = [...newShas.keys()].sort();

  for (const dest of sortedDests) {
    const newSha = newShas.get(dest)!;
    const diskSha = diskShas.get(dest);
    const lockSha = lock.entries.get(dest)?.sha256;

    if (diskSha === undefined) {
      actions.push({ kind: "add-new", dest });
      continue;
    }
    if (diskSha === newSha) {
      actions.push({ kind: "unchanged", dest });
      continue;
    }
    if (lockSha === undefined) {
      actions.push({ kind: "preserve", dest, reason: "customized" });
      continue;
    }
    if (diskSha === lockSha) {
      actions.push({ kind: "auto-update", dest, oldSha: lockSha, newSha });
      continue;
    }
    actions.push({ kind: "preserve", dest, reason: "customized" });
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
