import { type Approvals, APPROVALS_FILE, parseApprovals } from "../domain/skill_approvals.ts";
import type { GitObjectReader } from "./script_trust_ports.ts";

/**
 * The skill approvals (`skill_approvals.ts`) as a commit holds them, from git objects, never the
 * work tree: the one home of that read, a sibling of `base_lock.ts`. Which commit is the caller's
 * rule: the judge reads the base's tip (`shipped_copies.ts`), so the branch never vouches for
 * itself; the write reads HEAD (`record_approvals.ts`), the file it replaces.
 */

/** The approvals read, or none and why: a file that cannot be read approves nothing. */
export type CommittedApprovals = {
  readonly approvals: Approvals;
  readonly refused: string | null;
};

/**
 * The approvals at `commit`. No file is none. A link, a folder, a submodule, a file out of form
 * (a git-lfs pointer among them) or one too large to read is none too, and `refused` says why: never
 * a part of a file, and never a throw, so a broken file asks again rather than stopping the check.
 */
export async function committedApprovals(
  git: GitObjectReader,
  commit: string,
): Promise<CommittedApprovals> {
  try {
    const file = await git.readFile(commit, APPROVALS_FILE);
    if (file.kind === "absent") return { approvals: new Map(), refused: null };
    if (file.kind === "not_regular") return refused("is not a regular file");
    return { approvals: parseApprovals(file.bytes), refused: null };
  } catch (err) {
    // Reported, not swallowed: each caller's handler prints `refused` as a warning on stderr.
    return refused(err instanceof Error ? err.message : String(err));
  }
}

const refused = (why: string): CommittedApprovals => ({ approvals: new Map(), refused: why });
