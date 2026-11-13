import { dirname } from "@std/path";

/**
 * The folder checks the review pass, the review lock and the session records share: a folder they
 * write into is made where missing, and one that exists as anything but a folder, a link included,
 * is never gone through.
 */

/** The entry at `path` as it is, never followed; `null` when nothing is there. */
export async function lstatOrNull(path: string): Promise<Deno.FileInfo | null> {
  try {
    return await Deno.lstat(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}

/** `dir` made where missing; one existing as anything but a folder, a link included, is refused. */
export async function realFolder(dir: string): Promise<void> {
  const info = await lstatOrNull(dir);
  if (info === null) await Deno.mkdir(dir, { mode: 0o700 });
  else if (!info.isDirectory) throw new Error(`${dir} is not a folder: a link is not followed`);
}

/**
 * Why the folder `dir` cannot be gone through: it or its parent existing as anything but a folder,
 * a link included; `null` when neither does.
 */
export async function folderFault(dir: string): Promise<string | null> {
  for (const folder of [dirname(dir), dir]) {
    const info = await lstatOrNull(folder);
    if (info !== null && !info.isDirectory) return `${folder} is not a folder`;
  }
  return null;
}

/** {@link folderFault} as a throw: a resume and a renewal never go through a linked folder. */
export async function refuseFolderFault(dir: string): Promise<void> {
  const fault = await folderFault(dir);
  if (fault !== null) throw new Error(`${fault}: a link is not followed`);
}
