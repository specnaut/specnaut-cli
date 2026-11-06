/**
 * What the base branch is called, and which ref anchors it: the binary's reading of the rule
 * `base-branch.sh` holds for the scripts (a differential test keeps the two names equal).
 *
 * A name git would read as an option (`--exec=…`), or one holding `..` (a range), is refused: every
 * caller hands it to git as an argument.
 */

const BRANCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const ORIGIN_HEAD_PREFIX = "refs/remotes/origin/";

/** `name` when it is a plain branch name, else `null`. */
export function plainBranchName(name: string): string | null {
  return BRANCH_NAME.test(name) && !name.includes("..") ? name : null;
}

/** The branch `refs/remotes/origin/HEAD` points at, from its full target ref; `null` if none. */
export function branchOfOriginHead(target: string): string | null {
  if (!target.startsWith(ORIGIN_HEAD_PREFIX)) return null;
  return plainBranchName(target.slice(ORIGIN_HEAD_PREFIX.length));
}

/**
 * The full ref the base is read at: origin's copy whenever an origin is configured, so a local
 * branch that moved does not move the base; the local branch only in a repository with no origin.
 */
export function baseAnchorRef(base: string, hasOrigin: boolean): string {
  return hasOrigin ? `${ORIGIN_HEAD_PREFIX}${base}` : `refs/heads/${base}`;
}
