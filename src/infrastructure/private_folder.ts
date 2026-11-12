import { dirname } from "@std/path";
import { ExportRefused } from "../application/untrusted_review_ports.ts";

/**
 * The folder the exports live in must be the user's alone. Anyone else who can write it, or any
 * folder above it, can swap a folder of an export between the moment it is made and the moment it
 * is read. So the folder must be owned by this user and closed to group and others (a looser mode
 * on a folder the user owns is tightened), and no folder above it may be writable by group or
 * others unless its sticky bit stops them renaming what is not theirs. POSIX only: Windows has
 * neither the mode bits nor the owner id this reads.
 */

/** The parts of a `Deno.FileInfo` the rule reads. */
export type FolderInfo = {
  readonly isDirectory: boolean;
  readonly uid: number | null;
  readonly mode: number | null;
};

const STICKY = 0o1000;

/** Why `info` may not hold the exports, or `null`; a mode it can tighten is not a fault. */
export function privateFolderFault(info: FolderInfo, uid: number | null): string | null {
  if (!info.isDirectory) return "is not a folder";
  if (info.uid === null || uid === null || info.uid !== uid) return "is not owned by this user";
  return null;
}

/** Whether a folder above the exports lets another user replace what sits in it. */
export function looseAncestor(info: FolderInfo): boolean {
  const mode = info.mode ?? 0;
  return (mode & 0o022) !== 0 && (mode & STICKY) === 0;
}

/** Applies the rule to `root`, a resolved path, tightening its mode when it is the user's. */
export async function securePrivateFolder(root: string): Promise<void> {
  if (Deno.build.os === "windows") return;
  const info = await Deno.lstat(root);
  const fault = privateFolderFault(info, await ownUid());
  if (fault !== null) throw new ExportRefused(`the cache folder ${root} ${fault}`);
  if (((info.mode ?? 0) & 0o077) !== 0) await Deno.chmod(root, 0o700);
  for (let dir = dirname(root);; dir = dirname(dir)) {
    if (looseAncestor(await Deno.lstat(dir))) {
      throw new ExportRefused(`${dir} is writable by other users and has no sticky bit`);
    }
    if (dirname(dir) === dir) return;
  }
}

/**
 * This process's user id, read as the owner of a folder it has just made. `Deno.uid()` would need
 * `--allow-sys`, which neither the binary nor its test task is granted.
 */
async function ownUid(): Promise<number | null> {
  const probe = await Deno.makeTempDir({ prefix: "specnaut-uid-" });
  try {
    return (await Deno.lstat(probe)).uid;
  } finally {
    await Deno.remove(probe);
  }
}
