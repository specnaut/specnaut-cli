import { assertEquals, assertRejects } from "@std/assert";
import type { SubprocessRunner } from "../../src/application/ports.ts";
import { GhPullRequests, PR_FACTS_QUERY } from "../../src/infrastructure/gh_pull_request.ts";

/** A `gh` that answers `stdout` with `code`; the command lines it was given, in `ran`. */
function gh(stdout: string, code = 0, ran: string[][] = []): SubprocessRunner {
  return {
    run: (cmd, args) =>
      Promise.resolve(void ran.push([cmd, ...args])).then(() => ({
        code,
        stdout,
        stderr: code === 0 ? "" : "HTTP 401: Bad credentials\nmore",
      })),
  };
}

const FACTS = { authorAssociation: "MEMBER", headRefOid: "a".repeat(40), isCrossRepository: false };

Deno.test("the PR's facts come from the forge's GraphQL API, for this checkout's repository", async () => {
  const ran: string[][] = [];
  const body = JSON.stringify({ data: { repository: { pullRequest: FACTS } } });
  assertEquals(await new GhPullRequests(gh(body, 0, ran), "/repo").facts(12), FACTS);
  assertEquals(ran, [[
    "gh",
    "api",
    "graphql",
    "-f",
    `query=${PR_FACTS_QUERY}`,
    "-F",
    "owner={owner}",
    "-F",
    "repo={repo}",
    "-F",
    "number=12",
  ]]);
  for (const field of ["authorAssociation", "headRefOid", "isCrossRepository"]) {
    assertEquals(PR_FACTS_QUERY.includes(field), true, field);
  }
});

Deno.test("an answer naming no PR is no facts, and a failed or unreadable one is a throw", async () => {
  for (const body of ['{"data":{"repository":{"pullRequest":null}}}', '{"data":null}', "{}"]) {
    assertEquals(await new GhPullRequests(gh(body), "/repo").facts(12), null, body);
  }
  await assertRejects(
    () => new GhPullRequests(gh("", 1), "/repo").facts(12),
    Error,
    "gh exited 1: HTTP 401: Bad credentials",
  );
  await assertRejects(() => new GhPullRequests(gh("not json"), "/repo").facts(12), Error, "JSON");
});
