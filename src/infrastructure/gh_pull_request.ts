import type { SubprocessRunner } from "../application/ports.ts";

/**
 * A PR's facts from the forge, through `gh`: GraphQL, because only there does the PR object carry
 * `authorAssociation` under that name (`gh pr view` has no such field). The repository is the one
 * `gh` resolves for this checkout (`{owner}` and `{repo}`); a PR of another repository would
 * carry another head, so the decision's head check fails it rather than trusting it.
 */
export const PR_FACTS_QUERY = "query($owner: String!, $repo: String!, $number: Int!) { " +
  "repository(owner: $owner, name: $repo) { pullRequest(number: $number) { " +
  "authorAssociation headRefOid isCrossRepository } } }";

export class GhPullRequests {
  constructor(private readonly runner: SubprocessRunner, private readonly cwd: string) {}

  /** What the forge says of PR `n`, `null` when it names none; a failed call is a throw. */
  async facts(n: number): Promise<unknown> {
    const args = ["api", "graphql", "-f", `query=${PR_FACTS_QUERY}`];
    args.push("-F", "owner={owner}", "-F", "repo={repo}", "-F", `number=${n}`);
    const res = await this.runner.run("gh", args, { cwd: this.cwd });
    if (res.code !== 0) {
      throw new Error(`gh exited ${res.code}: ${res.stderr.trim().split("\n")[0].slice(0, 200)}`);
    }
    const said = JSON.parse(res.stdout) as { data?: { repository?: { pullRequest?: unknown } } };
    return said?.data?.repository?.pullRequest ?? null;
  }
}
