import { sha256HexBytes } from "./sha256.ts";

/**
 * HEAD's reflog as the checkout check reads it: the file git appends one line to each time HEAD
 * moves, `<old sha> <new sha> <who> <when>\t<message>`. Each entry written since a session started
 * names commits HEAD was on during it, so a branch checked out and left again is still seen,
 * though HEAD and the folder no longer show it.
 */

/** One entry: two full shas, then who moved HEAD, when, and why. */
const ENTRY = /^([0-9a-f]{40}(?:[0-9a-f]{24})?) ([0-9a-f]{40}(?:[0-9a-f]{24})?) [^\n]+$/;

/** The sha git writes for no commit. */
const NONE = /^0+$/;

/**
 * The reflog as it stood at session start: its length in bytes and their SHA-256. git only
 * appends to it as HEAD moves; a file that no longer begins with exactly those bytes had entries
 * expired or deleted, and what HEAD was on since can no longer be told from it.
 */
export type ReflogMark = { readonly bytes: number; readonly sha256: string };

/** The mark of `log`, or `null` when it holds no entry or anything that is not whole entries. */
export async function reflogMark(log: Uint8Array): Promise<ReflogMark | null> {
  const entries = entriesOf(log);
  if (entries === null || entries.length === 0) return null;
  return { bytes: log.length, sha256: await sha256HexBytes(log) };
}

/**
 * The commits the entries appended since `mark` name, each once, newest first: where each entry
 * moved HEAD to and from, so a visit whose own entry was deleted is still named by the next one's.
 * `null` when `log` no longer begins with the marked bytes, or what follows is not whole entries.
 */
export async function reflogSince(mark: ReflogMark, log: Uint8Array): Promise<string[] | null> {
  if (await sha256HexBytes(log.subarray(0, mark.bytes)) !== mark.sha256) return null;
  const entries = entriesOf(log.subarray(mark.bytes));
  if (entries === null) return null;
  const commits = entries.reverse().flatMap((e) => {
    const [, from, to] = ENTRY.exec(e)!;
    return [to, from];
  });
  return [...new Set(commits.filter((c) => !NONE.test(c)))];
}

/** Whether `v` is a mark as a record holds it. */
export function isReflogMark(v: { bytes?: unknown; sha256?: unknown }): v is ReflogMark {
  return Number.isInteger(v.bytes) && (v.bytes as number) > 0 &&
    typeof v.sha256 === "string" && /^[0-9a-f]{64}$/.test(v.sha256);
}

/** The entries of `bytes`, each ending in a newline, or `null` when anything else is there. */
function entriesOf(bytes: Uint8Array): string[] | null {
  const text = new TextDecoder().decode(bytes);
  if (text !== "" && !text.endsWith("\n")) return null;
  const lines = text === "" ? [] : text.slice(0, -1).split("\n");
  return lines.every((l) => ENTRY.test(l)) ? lines : null;
}
