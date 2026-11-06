import { assert, assertStringIncludes } from "@std/assert";
import { flat, phase } from "./task_docs.ts";

/**
 * The merge's side of the script check (§ 6 M2, M4; S-F2): it verifies before any script of the
 * tree runs and again before landing, an untrusted verdict lands only on the user's yes, and every
 * other outcome lands nothing. Pinned on the phases as the bundle ships them.
 */

Deno.test("merge verifies before its first script and before land-feature.sh, and re-verifies", () => {
  const merge = phase("merge").content;
  const verify = merge.indexOf("specnaut verify-scripts");
  assert(verify >= 0, "merge.md never runs the verifier");
  for (const script of ["epic-status.sh", "run-gate.sh", "land-feature.sh", "move.sh"]) {
    const at = merge.indexOf(`bash .specnaut/scripts/bash/${script}`);
    const first = at >= 0 ? at : merge.indexOf(script);
    assert(first > verify, `${script} is named before the verifier runs`);
  }
  const m = flat(merge);
  assertStringIncludes(m, "and again before step 3 and after every commit this phase makes");
  assertStringIncludes(m, "**Land it** — after step 0 ran again on the history as it now stands");
  assertStringIncludes(m, "A row that rebases runs step 0 again before it lands again.");
});

Deno.test("an untrusted verdict at merge is a stop, in either merge mode, and nothing else lands", () => {
  const m = flat(phase("merge").content);
  assertStringIncludes(
    m,
    "this run's merge mode is `manual`, whatever `phases/auto-chain.md` read",
  );
  assertStringIncludes(m, "Yes lands these scripts and runs them to land.");
  assertStringIncludes(m, "anything else stays on the branch, nothing landed");
  assertStringIncludes(m, "output without the three trusted parts: stop on the branch");
  assertStringIncludes(m, "Nothing lands.");
  assertStringIncludes(m, "every reason `behind base: rebase`");
});

Deno.test("auto-chain reads an untrusted verdict, or a changed workflow.yml, as manual", () => {
  const a = flat(phase("auto-chain").content);
  const verify = a.indexOf("specnaut verify-scripts");
  assert(verify >= 0 && verify < a.indexOf("bash .specnaut/scripts/bash/merge-mode.sh"));
  assertStringIncludes(a, "or a `NAMES_FILE` that lists `.specnaut/workflow.yml`, means `manual`");
});

Deno.test("merge-close stops before any backlog write when the branch changed backlog-config.yml", () => {
  const c = flat(phase("merge-close").content);
  const stop = c.indexOf("lists `.specnaut/backlog-config.yml`, **stop before any backlog write**");
  assert(stop >= 0, "merge-close.md has no backlog-config stop");
  assert(stop < c.indexOf("cascade-check.sh"), "the stop comes after a backlog script");
  assertStringIncludes(c, "run them only while `HEAD` is the commit `LANDED` ends at");
});

Deno.test("review runs the gate block first and never falls back to a script of the tree", () => {
  const r = phase("review").content;
  const gate = r.indexOf("<!-- review-gate: verify-scripts -->");
  assert(gate >= 0 && gate < r.indexOf("collect-audit-scope.sh"), "the gate is not first");
  assert(!r.includes("git-read.sh base"), "review.md still reads its base from the tree");
  assertStringIncludes(flat(r), "never fall back to a script of the tree");
  const seats = flat(phase("review-seats").content);
  assertStringIncludes(seats, "briefs every step below as `NOT RUN: <reason>`");
  assertStringIncludes(seats, "every signal-gated seat is dispatched");
});
