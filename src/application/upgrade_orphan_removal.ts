import type { BackupReport, FsWriter } from "./ports.ts";
import type { UpgradePlan } from "../domain/upgrade_plan.ts";
import { deletesOrphan, orphanScope, relabelRefused } from "../domain/orphan_scope.ts";

/**
 * Delete the orphans this run removes (`deletesOrphan`): a vanilla one
 * outright, a customised one only under `--force` and backed up first.
 *
 * `within` re-asks `orphanScope` on the path with symlinks resolved (cli#665).
 * The plan only read the text, and a committed link under a managed folder
 * can lead anywhere else in the project. Returns the plan with each orphan
 * the writer refused re-labelled `orphan-refused`, so the summary reports
 * what happened rather than what was planned; its entry leaves the lock.
 */
export async function removeOrphans(
  writer: FsWriter,
  plan: UpgradePlan,
  projectDir: string,
  force: boolean,
  managedRoots: ReadonlyArray<string> | undefined,
  notes: string[],
): Promise<{ backups: BackupReport["backups"]; plan: UpgradePlan }> {
  const removes = plan.filter((a) => deletesOrphan(a, force));
  const within = (rel: string) => orphanScope(rel, managedRoots) === "in-scope";
  let backups: BackupReport["backups"] = [];
  const refused = new Set<string>();
  for (const backupExisting of [false, true]) {
    const paths = removes.flatMap((a) =>
      a.kind === "remove" && a.wasCustomized === backupExisting ? [a.dest] : []
    );
    if (paths.length === 0) continue;
    const r = await writer.deletePaths(paths, projectDir, { backupExisting, within });
    backups = [...backups, ...r.backups];
    for (const dest of r.refused ?? []) refused.add(dest);
    notes.push(...(r.notes ?? []));
  }
  return { backups, plan: relabelRefused(plan, refused) };
}
