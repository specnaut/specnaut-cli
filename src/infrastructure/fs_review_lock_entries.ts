import { isAbsolute, join } from "@std/path";
import { isFullSha } from "../domain/commit_sha.ts";
import { type LockedReview, UNKNOWN_REVIEW } from "../domain/review_lock.ts";
import { lstatOrNull } from "./fs_review_pass.ts";

/**
 * Reading the review lock's entries (`fs_review_lock.ts`): a folder of `<session id>.json` files,
 * each locking its session whatever it holds, and anything but a folder locking every session.
 */

/**
 * An entry as written: the review it records, and the per-user folder its copy went to, `null`
 * where it does not say (an entry an earlier version wrote, or one that cannot be read).
 */
export type LockEntry = { readonly review: LockedReview; readonly state: string | null };

const UNKNOWN_ENTRY: LockEntry = { review: UNKNOWN_REVIEW, state: null };

/** What the locks in `dir` record for `id`; for `null`, whether any is there. */
export async function heldIn(dir: string, id: string | null): Promise<LockedReview | null> {
  if (id !== null) return (await entryIn(dir, id))?.review ?? null;
  const info = await lstatOrNull(dir);
  if (info === null) return null;
  if (!info.isDirectory) return UNKNOWN_REVIEW;
  return (await entryNames(dir)).length > 0 ? UNKNOWN_REVIEW : null;
}

/** The entry of the session `id` in `dir`; anything but a folder there is one naming nothing. */
export async function entryIn(dir: string, id: string): Promise<LockEntry | null> {
  const info = await lstatOrNull(dir);
  if (info === null) return null;
  if (!info.isDirectory) return UNKNOWN_ENTRY;
  return await readEntry(join(dir, `${id}.json`));
}

/** The review the entry at `path` records; `null` when there is none, a link counting as one. */
export async function entryAt(path: string): Promise<LockedReview | null> {
  return (await readEntry(path))?.review ?? null;
}

async function readEntry(path: string): Promise<LockEntry | null> {
  const info = await lstatOrNull(path);
  if (info === null) return null;
  return info.isFile ? entryOf(await Deno.readTextFile(path)) : UNKNOWN_ENTRY;
}

function entryOf(text: string): LockEntry {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return UNKNOWN_ENTRY;
    const { head, logs, base, toolchain, state } = parsed as Record<string, unknown>;
    const review = {
      head: typeof head === "string" && isFullSha(head) ? head : null,
      logs: typeof logs === "string" && isAbsolute(logs) ? logs : null,
      // Only an entry that records a base names one: an earlier entry pins `--base` to nothing.
      ...(base === undefined
        ? {}
        : { base: typeof base === "string" && isFullSha(base) ? base : null }),
      // A toolchain is folders, each absolute: one entry of any other kind records none.
      ...(toolchain === undefined ? {} : { toolchain: foldersOf(toolchain) }),
    };
    return { review, state: typeof state === "string" ? state : null };
  } catch (err) {
    // Not swallowed: an entry that is not JSON locks all the same, naming nothing.
    if (!(err instanceof SyntaxError)) throw err;
    return UNKNOWN_ENTRY;
  }
}

/** `value` as a list of absolute folders, or none when any item is not one. */
function foldersOf(value: unknown): string[] {
  const folders = Array.isArray(value) ? value : [];
  return folders.every((f) => typeof f === "string" && f.startsWith("/") && !f.includes(":"))
    ? folders
    : [];
}

export async function entryNames(dir: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(dir)) names.push(entry.name);
  return names.sort();
}
