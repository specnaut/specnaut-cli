import { assert, assertStringIncludes } from "@std/assert";
import { flat } from "./task_docs.ts";

/**
 * How the phases act on a config verdict that does not fault the branch: a merge rebases a branch
 * that only lags the base, `--scan` still draws its map, and a review rates size from the table
 * the base holds rather than the copy in the work tree.
 */

const read = (rel: string) =>
  flat(Deno.readTextFileSync(new URL(`../../templates/core/${rel}`, import.meta.url)));
const TASK = "skills/task/phases";

Deno.test("merge rebases on a config line behind the base, and judges workflow on the last run", () => {
  const m = read(`${TASK}/merge.md`);
  assertStringIncludes(
    m,
    "A config line whose reason is `behind base: rebase` is handled as that reason is for a " +
      "script: `git rebase refs/remotes/origin/<BASE_BRANCH>`, then this step again at once",
  );
  assertStringIncludes(m, "the `workflow` line counts on the last run only");
  assert(
    !m.includes("so does any run unless it printed `VERDICT workflow trusted`"),
    "a workflow line from an earlier run still makes the mode manual",
  );
});

Deno.test("audit --scan draws its map under untrusted limits or no base, and says so", () => {
  const a = read(`${TASK}/audit.md`);
  assertStringIncludes(
    a,
    "**`--scan` is the exception**: the map is where to look, never a verdict, so it still runs " +
      "under any other `size-limits` line, or none because the gate found no base (exit 3)",
  );
  assertStringIncludes(
    a,
    "`Note: the size limits are the work tree's, not checked against the base — " +
      "<the line, or verify-scripts exit 3>`",
  );
});

Deno.test("a review rates size from the base tip's table, never from the work tree's copy", () => {
  const s = read(`${TASK}/review-seats.md`);
  assertStringIncludes(
    s,
    "`bash .specnaut/scripts/bash/git-read.sh grep '|' <BASE_TIP> .specnaut/memory/size-limits.md`",
  );
  assertStringIncludes(s, "the work tree's `.specnaut/memory/size-limits.md` is never read for it");
  assert(!s.includes("Severity for size comes from that file's table"), "the tree's table rates");
  const reviewer = read("agents/code-reviewer.md");
  assertStringIncludes(reviewer, "the severity table as your brief carries it from the base");
});
