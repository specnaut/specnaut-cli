import { dirname } from "@std/path";
import { isInside } from "../domain/template.ts";

/**
 * Removes `dir` and each now-empty ancestor, stopping below `stopAt`.
 *
 * Deleting a file leaves its directory behind. For a file that simply went
 * away that is invisible; for a *renamed* skill it is not — the emptied
 * folder keeps the old command's name sitting in the harness's skills
 * directory, so `upgrade` reports "removed" while the old name is still
 * listed. `FsStagingStore.delete` has always pruned its own parents; the
 * real tree did not, and the asymmetry is what let the ghost through.
 *
 * Containment via `isInside`, not a string prefix. The first version tested
 * `current.startsWith(stopAt + "/")`, which hardcodes the POSIX separator: on
 * Windows `resolve` yields `C:\a\b`, the prefix never matched, and the prune
 * silently never ran. The equality case is the `while` condition's: `isInside`
 * counts a root as inside itself, and stopping AT `stopAt` is this walk's own
 * business.
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
    if (!isInside(stopAt, current)) return;
    try {
      if ((await Deno.lstat(current)).isSymlink) return;
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
