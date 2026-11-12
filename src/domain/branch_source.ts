/**
 * Which branch to fetch, as the user names it: a PR number or `<remote>/<branch>` on a remote
 * already configured in their repository. A URL or a path is refused, so where the objects come
 * from is always a remote the user set up themselves, never text that arrived with the request.
 */

export type BranchSource =
  | { readonly kind: "pr"; readonly remote: string; readonly number: number }
  | { readonly kind: "ref"; readonly remote: string; readonly branch: string };

export type ParsedSource = BranchSource | { readonly kind: "refused"; readonly why: string };

/** The one ref the fetched head is written to, in a repository made for the fetch alone. */
export const FETCHED_REF = "refs/specnaut/head";

/** The remote a bare PR number is fetched from: forges publish `refs/pull/<n>/head` there. */
const PR_REMOTE = "origin";

/** Ten digits at most, no leading zero: a PR number, never an expression git or a shell reads. */
const PR_NUMBER = /^#?([1-9][0-9]{0,9})$/;

/**
 * One segment of a branch name: a conservative subset of `git check-ref-format`, so the name can
 * never read as an option, a revision expression (`~`, `^`, `@{`, `:`), a glob or a path step.
 */
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/** The PR number `text` names (`12` or `#12`), or `null` when it names none. */
export function prNumberOf(text: string): number | null {
  const pr = PR_NUMBER.exec(text);
  return pr === null ? null : Number(pr[1]);
}

export function parseBranchSource(text: string, remotes: readonly string[]): ParsedSource {
  const number = prNumberOf(text);
  if (number !== null) {
    if (!remotes.includes(PR_REMOTE)) return refused(`no remote named ${PR_REMOTE} is configured`);
    return { kind: "pr", remote: PR_REMOTE, number };
  }
  if (/[:\\]/.test(text) || /^[/.~]/.test(text)) {
    return refused("a URL or a path is not accepted: name a PR number or <remote>/<branch>");
  }
  // Remote names may hold a slash themselves: the longest configured one that prefixes wins.
  const remote = [...remotes].sort((a, b) => b.length - a.length)
    .find((r) => text.startsWith(`${r}/`));
  if (remote === undefined) return refused("the text names no configured remote");
  const branch = text.slice(remote.length + 1);
  if (!isSafeBranch(branch)) return refused(`not a branch name this accepts: ${branch}`);
  return { kind: "ref", remote, branch };
}

function isSafeBranch(branch: string): boolean {
  if (branch.length === 0 || branch.length > 255 || branch.includes("..")) return false;
  return branch.split("/").every((s) => SEGMENT.test(s) && !s.endsWith(".lock"));
}

/** The remote ref a source names; only ever placed after `--` on the fetch's command line. */
export function refspecOf(source: BranchSource): string {
  return source.kind === "pr" ? `refs/pull/${source.number}/head` : `refs/heads/${source.branch}`;
}

const refused = (why: string): ParsedSource => ({ kind: "refused", why });
