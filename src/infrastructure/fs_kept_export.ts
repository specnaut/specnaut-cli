import { join } from "@std/path";
import { ExportRefused, type KeptExport } from "../application/untrusted_review_ports.ts";
import { isFullSha } from "../domain/commit_sha.ts";
import type { ExportPlan } from "../domain/tree_plan.ts";
import { openCopySync, SEALED, verifyCopy } from "./fs_export_files.ts";

/**
 * The export a review kept, found by its commit id under the cache folder when the review closes
 * (`fs_tree_export.ts` made it). Only a folder named by a full commit id is taken; a link at that
 * name is refused, never followed.
 */
export async function keptExport(cacheRoot: string, sha: string): Promise<KeptExport | null> {
  if (!isFullSha(sha)) throw new ExportRefused("not a full commit id");
  const root = join(cacheRoot, sha);
  let info: Deno.FileInfo;
  try {
    info = await Deno.lstat(root);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
  if (!info.isDirectory) throw new ExportRefused(`${root} is not a folder: a link is not followed`);
  const seats = join(root, "seats");
  return {
    gitDir: join(root, "git"),
    verify: (plan: ExportPlan) => verifyCopy(seats, plan, SEALED.file),
    remove: async () => {
      openCopySync(seats);
      await Deno.remove(root, { recursive: true });
    },
  };
}
