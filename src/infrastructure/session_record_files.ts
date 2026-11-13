import { dirname, join } from "@std/path";
import type { RecordWrite } from "../application/script_trust_ports.ts";
import { isSessionId, RECORD_RETENTION_MS } from "../domain/session_record.ts";
import { lstatOrNull } from "./fs_review_pass.ts";

/**
 * The files of one session record folder, `<git dir>/specnaut/session/`, as `FsSessionRecords`
 * keeps them: a record placed without opening any file or link for writing, its last use renewed,
 * and other sessions' stale records pruned. Every path here is built from the folder the adapter
 * was opened on, never from the work tree.
 */

/**
 * Why the record folder `dir` cannot be gone through: `specnaut/` or `session/` existing as
 * anything but a folder, a link included; `null` when neither does.
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

/**
 * `text` written to a file created new in `dir`, then hard-linked to `<id>.json`, which fails when
 * anything is already there: the record taken, or the one already there kept and renewed.
 */
export async function placeRecord(
  dir: string,
  sessionId: string,
  text: string,
): Promise<RecordWrite> {
  const path = join(dir, `${sessionId}.json`);
  const temp = join(dir, `.${sessionId}.${crypto.randomUUID()}.tmp`);
  await Deno.writeTextFile(temp, text, { createNew: true, mode: 0o600 });
  let placed: RecordWrite;
  try {
    placed = await linked(temp, path);
  } catch (err) {
    await removeAfter(temp, err);
    throw err;
  }
  await Deno.remove(temp);
  if (placed.kind === "existing") await renew(path);
  return placed;
}

/**
 * A record's last use set to now, from which its retention counts. Only a regular file: a link is
 * left as it is, never followed, and refused when read. A record folder that is a link is refused:
 * the times set through it would be another folder's record's.
 */
export async function renew(path: string): Promise<void> {
  await refuseFolderFault(dirname(path));
  if (!(await lstatOrNull(path))?.isFile) return;
  const now = new Date();
  await Deno.utime(path, now, now);
}

/**
 * The records, and the temp files a failed write left, that sessions other than `current` last
 * wrote over {@link RECORD_RETENTION_MS} before `now`, removed from `dir`. A folder is never
 * removed, and a file another session removed first is already gone.
 */
export async function pruneRecords(dir: string, current: string, now: number): Promise<void> {
  for await (const entry of Deno.readDir(dir)) {
    const owner = /^(.+)\.json$/.exec(entry.name)?.[1] ?? TEMP.exec(entry.name)?.[1];
    if (owner === undefined || !isSessionId(owner) || owner === current) continue;
    const info = entry.isDirectory ? null : await lstatOrNull(join(dir, entry.name));
    const written = info?.mtime?.getTime();
    if (written === undefined || now - written <= RECORD_RETENTION_MS) continue;
    await removeIfThere(join(dir, entry.name));
  }
}

/** A temp file {@link placeRecord} creates: `.<session id>.<uuid>.tmp`. */
const TEMP = /^\.(.+)\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;

/** `temp` linked to `path`: taken, or the record already there kept. */
async function linked(temp: string, path: string): Promise<RecordWrite> {
  try {
    await Deno.link(temp, path);
    return { kind: "taken", path };
  } catch (err) {
    if (!(err instanceof Deno.errors.AlreadyExists)) throw err;
    return { kind: "existing", path };
  }
}

/**
 * The temp file removed after the write failed with `failure`. Should the removal fail too, the
 * error thrown is still the write's: its message first, `failure` as its cause, the removal's
 * appended. The file left behind is pruned by a later write.
 */
async function removeAfter(temp: string, failure: unknown): Promise<void> {
  try {
    await Deno.remove(temp);
  } catch (removal) {
    const why = (e: unknown) => e instanceof Error ? e.message : String(e);
    throw new Error(`${why(failure)} (and ${temp} could not be removed: ${why(removal)})`, {
      cause: failure,
    });
  }
}

async function removeIfThere(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch (err) {
    // Not swallowed: a record another session's write pruned first is the outcome sought.
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
}
