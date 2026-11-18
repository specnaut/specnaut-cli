import { type Approvals, APPROVALS_FILE, parseApprovals } from "../domain/skill_approvals.ts";
import type { GitObjectReader } from "./script_trust_ports.ts";

/**
 * The skill approvals (`skill_approvals.ts`) as the base's tip commits them, from git objects: never
 * the work tree, never HEAD, so the branch being judged never vouches for itself. A sibling of
 * `base_lock.ts`, read the same way.
 */

/** The approvals read, or none and why: a file that cannot be read approves nothing. */
export type BaseApprovals = { readonly approvals: Approvals; readonly refused: string | null };

/**
 * The approvals at `baseTip`. No file is none. A link, a folder, a submodule, a file out of form
 * (a git-lfs pointer among them) or one too large to read is none too, and `refused` says why: never
 * a part of a file, and never a throw, so a broken file asks again rather than stopping the check.
 */
export async function baseApprovals(
  git: GitObjectReader,
  baseTip: string,
): Promise<BaseApprovals> {
  try {
    const file = await git.readFile(baseTip, APPROVALS_FILE);
    if (file.kind === "absent") return { approvals: new Map(), refused: null };
    if (file.kind === "not_regular") return refused("is not a regular file");
    return { approvals: parseApprovals(file.bytes), refused: null };
  } catch (err) {
    // Reported, not swallowed: the handler prints `refused` as a warning on stderr.
    return refused(err instanceof Error ? err.message : String(err));
  }
}

const refused = (why: string): BaseApprovals => ({ approvals: new Map(), refused: why });
