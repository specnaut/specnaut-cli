/**
 * Moving a file aside instead of destroying it — the `.specnaut.bak` every
 * write and delete in the bundle writer leaves behind when asked to. Its own
 * module so the link writer and the bundle writer share one definition of a
 * backup that destroys nothing.
 */
const BACKUP_SUFFIX = ".specnaut.bak";

/** Move `abs` aside instead of deleting it, and say what was moved. */
export async function backupForDelete(abs: string, dest: string) {
  const wasSymlink = await isSymlink(abs);
  const suffix = await backupAside(abs);
  return {
    dest,
    backupPath: `${dest}${suffix}`,
    ...(wasSymlink ? { wasSymlink: true as const } : {}),
  };
}

/** Whether `path` is itself a symlink — `lstat`, never `stat`. */
export async function isSymlink(path: string): Promise<boolean> {
  try {
    return (await Deno.lstat(path)).isSymlink;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

/**
 * Moves `abs` aside to a backup that destroys nothing, and returns the suffix
 * that was actually used.
 *
 * `Deno.rename` overwrites its destination silently, so a second backup of the
 * same path erased the first. That is not a tidiness problem: switching backlog
 * backend `local → github → local → github` backed up the user's real
 * `.specnaut/backlog.md` on the first switch and then overwrote that backup
 * with the freshly-scaffolded template on the third. Same shape for a repeated
 * `--force`: run one saves the user's edits, run two replaces them with the
 * bundle content the force had just written. Every path here is reached
 * BECAUSE a file was about to be destroyed, so the one thing this must never
 * do is destroy the record of the last time.
 *
 * The rolled names keep the `.specnaut.bak` tail (`x.2.specnaut.bak`, not
 * `x.specnaut.bak.2`) because the scaffolded `.gitignore` ignores
 * `*.specnaut.bak` — a suffix appended after it would be committed.
 */
export async function backupAside(abs: string): Promise<string> {
  let suffix = BACKUP_SUFFIX;
  for (let n = 2; await fileExists(`${abs}${suffix}`); n++) {
    suffix = `.${n}${BACKUP_SUFFIX}`;
  }
  await Deno.rename(abs, `${abs}${suffix}`);
  return suffix;
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

export async function readIfExists(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}
