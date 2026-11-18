import { isSkillPath } from "./shipped_skills.ts";

/**
 * A user's yes to a customised copy of a skill Specnaut ships, kept so the merge does not ask about
 * the same bytes again (`shipped_skills.ts`). Each approval binds one path to the SHA-256 of the
 * bytes the yes covered: one byte changed, and the copy is asked about again.
 *
 * The file is read only as the base's tip commits it, never from the work tree or HEAD: the branch
 * being judged must never vouch for itself. Only the landing writes it, as its own commit after the
 * yes (`land-feature.sh`). The form is strict, `sha256sum`'s: `<64 lowercase hex>  <path>\n` per
 * approval, sorted by path, each path once, LF only. Anything else approves nothing, never a part.
 */

export const APPROVALS_FILE = ".specnaut/approved-skills.txt";

/** Each approved path, with the SHA-256 of the bytes the yes covered. */
export type Approvals = ReadonlyMap<string, string>;

const LINE = /^([0-9a-f]{64}) {2}(.+)$/;

/**
 * Whether `path` may name an approval: a path in a skill folder Specnaut writes, written as git
 * lists it. No empty, `.` or `..` part, no backslash, no control character: a key one reader could
 * take for another path is refused.
 */
export function isApprovalKey(path: string): boolean {
  // deno-lint-ignore no-control-regex -- matching the C0 and C1 controls is the point
  if (!isSkillPath(path) || /[\x00-\x1f\x7f-\x9f\\]/.test(path)) return false;
  return path.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

/** The approvals `bytes` hold, or a throw naming the first thing out of form. */
export function parseApprovals(bytes: Uint8Array): Map<string, string> {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const out = new Map<string, string>();
  if (text === "") return out;
  if (!text.endsWith("\n")) throw new Error("does not end with a line feed");
  let last = "";
  for (const line of text.slice(0, -1).split("\n")) {
    const m = LINE.exec(line);
    if (m === null) throw new Error("holds a line that is not `<sha256>  <path>`");
    const [, sha256, path] = m;
    if (!isApprovalKey(path)) throw new Error("names a path outside the skill folders");
    if (out.size > 0 && path <= last) throw new Error("is not sorted by path, each path once");
    out.set(path, sha256);
    last = path;
  }
  return out;
}

/** The file's text for `approvals`: the one form `parseApprovals` reads. */
export function renderApprovals(approvals: Approvals): string {
  const paths = [...approvals.keys()].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  return paths.map((p) => `${approvals.get(p)}  ${p}\n`).join("");
}

/** What HEAD holds at a path: its blob's SHA-256, and whether it is not a copy Specnaut ships. */
export type HeadCopy = { readonly sha256: string; readonly customised: boolean };

/**
 * The approvals a write leaves: each of `previous` while HEAD (`head`, by path) still holds the
 * bytes it names and they are still a customised copy, then `fresh`, which replaces any on its
 * path. A dormant approval never survives a write: one whose bytes are gone would vouch for them
 * again the day they come back, unseen.
 */
export function nextApprovals(
  previous: Approvals,
  head: ReadonlyMap<string, HeadCopy>,
  fresh: Approvals,
): Map<string, string> {
  const kept = [...previous].filter(([path, sha256]) => {
    const at = head.get(path);
    return at !== undefined && at.customised && at.sha256 === sha256;
  });
  return new Map([...kept, ...fresh]);
}
