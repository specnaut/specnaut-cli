import { changedStagedEntryRefusal } from "./fs_refusals.ts";

/**
 * The text of the staged entry `seen` describes, read from one handle that is
 * still that entry (cli#776): between the check and the open, the entry can be
 * swapped for a link or another file, and `open` follows whatever is there.
 * Only a regular file is opened — a FIFO would block the open — and the
 * handle's `fstat` must be a regular file on the device and inode `lstat` saw,
 * as `readChecked` in `fs_tree_walker.ts` does for a checkout.
 *
 * Per platform: Linux and macOS report the inode, Windows the file index, so a
 * swap is caught by identity. Where a platform reports none, the device alone
 * proves nothing, so the handle and a second `lstat` after the read must both
 * match the first one's size and mtime: a swap is then caught unless the new
 * file has the same size and timestamp, which is best effort and no more.
 */
export async function readSameEntry(
  root: string,
  full: string,
  seen: Deno.FileInfo,
): Promise<string> {
  if (!seen.isFile) throw changedStagedEntryRefusal(root, full);
  const file = await Deno.open(full, { read: true });
  let info: Deno.FileInfo;
  try {
    info = await file.stat();
  } catch (err) {
    file.close();
    throw err;
  }
  const noIno = seen.ino === null || info.ino === null;
  if (
    !info.isFile || info.dev !== seen.dev || info.ino !== seen.ino ||
    (noIno && !sameShape(info, seen))
  ) {
    file.close();
    throw changedStagedEntryRefusal(root, full);
  }
  const text = await new Response(file.readable).text();
  if (noIno && !sameShape(await Deno.lstat(full), seen)) {
    throw changedStagedEntryRefusal(root, full);
  }
  return text;
}

/** Same kind, size and mtime: the fallback evidence where no inode is reported. */
const sameShape = (a: Deno.FileInfo, b: Deno.FileInfo) =>
  a.isFile && !a.isSymlink && a.size === b.size && a.mtime?.getTime() === b.mtime?.getTime();
