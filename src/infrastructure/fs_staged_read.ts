import { changedStagedEntryRefusal } from "./fs_refusals.ts";

/**
 * The text of the staged entry `seen` describes, read from one handle that is
 * still that entry (cli#776): between the check and the open, the entry can be
 * replaced by a link or another file, and `open` follows whatever is there.
 * Only a regular file is opened — a FIFO would block the open — and the
 * handle's `fstat` must be a regular file on the device and inode `lstat` saw,
 * as `readChecked` in `fs_tree_walker.ts` does for a checkout.
 *
 * Per platform: Linux and macOS report the inode, Windows the file index, so a
 * replacement is caught by identity. Where a platform reports none, the device alone
 * proves nothing, so the handle's `fstat` before the read and a second `lstat` after
 * it must both match the first one's size and mtime (`sameEntry`). The handle's check
 * catches a replacement before the open; the second `lstat` catches a write during the
 * read, which changes the size or the mtime of the entry the handle reads. Where the
 * platform reports no mtime either, both mtimes are null and compare equal, so the
 * size alone is left to tell a change apart.
 *
 * The limit, stated rather than detected (cli#785): with no inode, a replacement by a
 * file of the same size and mtime is read as the staged copy. Nothing else a
 * stat reports would make the check sound: a creation time is set as an mtime is.
 */
export async function readSameEntry(
  root: string,
  full: string,
  seen: Deno.FileInfo,
  stats: EntryStats = SYSTEM_STATS,
): Promise<string> {
  if (!seen.isFile) throw changedStagedEntryRefusal(root, full);
  const file = await Deno.open(full, { read: true });
  let info: Deno.FileInfo;
  try {
    info = await stats.fstat(file);
  } catch (err) {
    file.close();
    throw err;
  }
  if (!sameEntry(seen, info)) {
    file.close();
    throw changedStagedEntryRefusal(root, full);
  }
  const text = await new Response(file.readable).text();
  if (seen.ino === null && !sameEntry(seen, await stats.lstat(full))) {
    throw changedStagedEntryRefusal(root, full);
  }
  return text;
}

/** The two stat calls `readSameEntry` makes: the open handle's, and the path's after the read. */
export type EntryStats = {
  readonly fstat: (file: Deno.FsFile) => Promise<Deno.FileInfo>;
  readonly lstat: (path: string) => Promise<Deno.FileInfo>;
};

const SYSTEM_STATS: EntryStats = { fstat: (file) => file.stat(), lstat: Deno.lstat };

/**
 * Whether `now` is still the regular file `seen` described: the same device and
 * inode, and, where neither reports an inode, the same size and mtime — the
 * stated limit above.
 */
export function sameEntry(seen: Deno.FileInfo, now: Deno.FileInfo): boolean {
  if (!now.isFile || now.dev !== seen.dev || now.ino !== seen.ino) return false;
  return seen.ino !== null || sameShape(now, seen);
}

/** Same kind, size and mtime: the fallback evidence where no inode is reported. */
const sameShape = (a: Deno.FileInfo, b: Deno.FileInfo) =>
  a.isFile && !a.isSymlink && a.size === b.size && a.mtime?.getTime() === b.mtime?.getTime();
