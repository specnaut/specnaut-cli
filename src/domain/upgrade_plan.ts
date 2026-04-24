import type { InstalledLock } from "./installed_lock.ts";

export type UpgradeAction =
  | { kind: "auto-update"; dest: string; oldSha: string; newSha: string }
  | { kind: "preserve"; dest: string; reason: "customized" }
  | { kind: "add-new"; dest: string }
  | { kind: "unchanged"; dest: string };

export type UpgradePlan = ReadonlyArray<UpgradeAction>;

/**
 * Compute the upgrade plan from three SHA256 snapshots:
 *   - `diskShas` : current content SHA of each file (absent = not on disk)
 *   - `lock`     : the .specflow/installed.lock
 *   - `newShas`  : SHA of each file in the binary's embedded templates
 *
 * Emits one UpgradeAction per destination in the new bundle. Files that
 * exist in the lock but NOT in the new bundle are ignored here (caller
 * handles the lock cleanup separately).
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

  return actions;
}
