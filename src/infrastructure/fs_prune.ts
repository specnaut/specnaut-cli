import { dirname } from "@std/path";
import { locate } from "./fs_containment.ts";

/**
 * Removes `dir` and each now-empty ancestor, stopping below `stopAt`.
 *
 * Deleting a file leaves its directory behind. For a file that simply went
 * away that is invisible; for a *renamed* skill it is not — the emptied
 * folder keeps the old command's name sitting in the harness's skills
 * directory, so `upgrade` reports "removed" while the old name is still
 * listed. `FsStagingStore.delete` prunes its own parents through this walk too;
 * the real tree once did not, and the asymmetry is what let the ghost through.
 *
 * Containment by REAL path, not path text (cli#751): each folder, resolved,
 * must lie strictly inside `stopAt`, resolved (`insideRealBound`). Compared as
 * text, a folder reached through a link under `stopAt` counted as inside it and
 * was removed where it really lies, outside. Checked before each `readDir`, on
 * the folder about to be removed; a folder outside, or `stopAt` itself, ends
 * the walk without a note, as a link does. A resolution that fails ends it too,
 * never falling back to text.
 *
 * A symlink stops the walk (cli#665): a link is the project's own choice, never
 * an emptied folder, and `Deno.remove` on it would delete the link it committed.
 *
 * Best-effort by construction: it never throws. A directory that cannot be
 * removed is not a reason to fail an upgrade whose files are already written —
 * but it is not silent either. Anything other than the directory already being
 * gone is pushed onto `notes`, naming the folder, so the ghost this walk exists to
 * remove cannot survive unreported.
 */
export async function pruneEmptyParents(
  dir: string,
  stopAt: string,
  notes: string[],
): Promise<void> {
  let current = dir;
  while (current !== stopAt) {
    try {
      if ((await Deno.lstat(current)).isSymlink) return;
      if (!(await insideRealBound(stopAt, current))) return;
      for await (const _ of Deno.readDir(current)) return; // still in use — stop
      await Deno.remove(current);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return;
      notes.push(`could not remove the emptied folder ${current}: ${(err as Error).message}`);
      return;
    }
    const parent = dirname(current);
    if (parent === current) return; // filesystem root; `dirname` is a fixpoint there
    current = parent;
  }
}

/**
 * Whether the folder `current` really lies strictly inside `stopAt`, both
 * resolved: the containment rule's own `locate`, so this walk keeps no second
 * real-path comparison. `"entry"` resolves `current`'s folders and keeps its
 * name, which is the folder itself, since the walk stops at a link first.
 */
async function insideRealBound(stopAt: string, current: string): Promise<boolean> {
  const realStop = await Deno.realPath(stopAt);
  const verdict = await locate(realStop, current, "entry");
  return verdict.kind === "inside" && verdict.resolved !== realStop;
}
