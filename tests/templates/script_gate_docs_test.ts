import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { flat, phase } from "./task_docs.ts";
import { scriptsApprovable } from "../../src/domain/approval_verdict.ts";
import { REASON } from "../../src/domain/trust_reason.ts";

/**
 * The merge's side of the script check: it verifies before any script of the tree runs, again
 * right after a rebase and before landing; an untrusted verdict lands only on the user's yes, which
 * covers one digest; a reason that names no script stops; every other outcome lands nothing.
 * Pinned on the phases as the bundle ships them.
 */

/** Where merge.md's step 0 begins and where step 1 begins. */
function steps(merge: string) {
  const zero = merge.indexOf("0. **Check the helper scripts");
  const one = merge.indexOf("1. **Shape the history.**");
  assert(zero >= 0 && one > zero, "merge.md has no step 0 before step 1");
  return { zero, one };
}

Deno.test("merge's step 0 verifies before the first script and again after a rebase", () => {
  const merge = phase("merge").content;
  const { zero, one } = steps(merge);
  const call = merge.indexOf('"$sn" verify-scripts', zero);
  assert(call > zero && call < one, "step 0 does not run the verifier");
  // Nothing before step 0 names a script of the tree; every one the steps run comes after it.
  assert(!/\.specnaut\/scripts\/|\.sh\b/.test(merge.slice(0, zero)), "a script before step 0");
  for (const script of ["epic-status.sh", "run-gate.sh", "land-feature.sh", "move.sh"]) {
    assert(merge.indexOf(script, one) > one, `${script} is not run after step 0`);
  }
  const m = flat(merge);
  assertStringIncludes(m, "again right after every `git rebase` this phase runs (before the gates");
  assertStringIncludes(m, "**Land it** — after step 0 ran again on the history as it now stands");
  assertStringIncludes(m, "A row that rebases runs step 0 right after its `git rebase`");
  assertStringIncludes(m, "Applies cleanly → step 0 at once, then re-run the gates");
});

Deno.test("an untrusted verdict is a stop whose yes covers one digest; other outcomes land nothing", () => {
  const merge = flat(phase("merge").content);
  const step0 = merge.slice(0, merge.indexOf("1. **Shape the history.**"));
  assertStringIncludes(
    step0,
    "The first case of `phases/script-gate.md` § Merge's step 0 outcomes",
  );
  const g = flat(phase("script-gate").content);
  const m = g.slice(g.indexOf("## Merge's step 0 outcomes"));
  assert(m.length < g.length, "script-gate.md has no section for merge's step 0 outcomes");
  assertStringIncludes(
    m,
    "this run's merge mode is `manual`, whatever `phases/auto-chain.md` read",
  );
  assertStringIncludes(m, "Yes lands these scripts and runs them to land.");
  assertStringIncludes(m, "The yes covers that run's `SCRIPTS_DIGEST` and its `UNTRUSTED` paths");
  assertStringIncludes(m, "or an `UNTRUSTED` path outside that set, asks again");
  assertStringIncludes(
    m,
    "at least one `UNTRUSTED` line and the last line `VERDICT scripts untrusted`",
  );
  assertStringIncludes(m, "An `UNTRUSTED` path outside `.specnaut/scripts/`");
  assertStringIncludes(m, "Never asked: no yes makes it hold.");
  assertStringIncludes(m, "anything else stays on the branch, nothing landed");
  assertStringIncludes(m, "Nothing lands.");
  assertStringIncludes(m, "Every reason `behind base: rebase`");
});

Deno.test("step 0 stops, never asking, on a scripts reason the binary lets no yes hold", () => {
  const g = flat(phase("script-gate").content);
  const m = g.slice(g.indexOf("## Merge's step 0 outcomes"));
  const start = m.indexOf("An `UNTRUSTED` reason under `.specnaut/scripts/` that no yes can hold");
  const end = m.indexOf("Every reason `behind base: rebase`");
  assert(
    start >= 0 && end > start,
    "no stop on an unholdable reason before the rebase and the ask",
  );
  const bullet = m.slice(start, end);
  assertStringIncludes(bullet, "**stop on the branch** and say why");
  assertStringIncludes(bullet, "`APPROVAL scripts moved`");
  assertStringIncludes(bullet, "Never asked.");
  // Each reason the binary prints is quoted whole in the one list its verdict puts it in: the
  // reasons a yes holds, or those no yes holds. A reason quoted in neither, or in the wrong one,
  // is a reason the phase would read the other way.
  const held = between(bullet, "A yes holds only these reasons:", "No yes holds any other");
  const never = between(bullet, "No yes holds any other", "Compare the whole reason");
  for (const reason of Object.values(REASON)) {
    const holdable = scriptsApprovable([{ path: ".specnaut/scripts/bash/x.sh", reason }]);
    assertEquals(held.includes(`\`${reason}\``), holdable, `held: ${reason}`);
    assertEquals(never.includes(`\`${reason}\``), !holdable, `never held: ${reason}`);
  }
  // `not a regular file` starts `not a regular file on base`: only the whole reason tells them apart.
  assertStringIncludes(bullet, "Compare the whole reason the line prints, never its start");
});

/** The text of `doc` from `start` up to `end`, each found once in that order. */
function between(doc: string, start: string, end: string): string {
  const from = doc.indexOf(start);
  const to = doc.indexOf(end, from);
  assert(from >= 0 && to > from, `no "${start}" before "${end}"`);
  return doc.slice(from, to);
}

Deno.test("after the scripts' yes, step 0 runs again with its digest before any script of the tree", () => {
  const merge = flat(phase("merge").content);
  const { zero, one } = steps(merge);
  const rerun = merge.indexOf(
    "After the scripts' yes, run this step again at once with `--approved-scripts " +
      "<SCRIPTS_DIGEST>`, before any script of the tree runs, on the local path and on `--pr` alike",
  );
  assert(rerun > zero && rerun < one, "step 0 does not run again after the scripts' yes");
  assertStringIncludes(
    merge,
    "`epic-status.sh`, `run-gate.sh` and `lfs-push.sh` run on what that run decides, never on " +
      "the run the question was asked from.",
  );
  const pr = merge.indexOf("2. **`--pr` only** — once step 0 ran again after any yes, push");
  assert(pr > one && pr < merge.indexOf("lfs-push.sh", pr), "--pr pushes before step 0 ran again");
});

Deno.test("auto-chain defers an untrusted verdict to merge's step 0 and asks one question", () => {
  const a = flat(phase("auto-chain").content);
  const step0 = a.indexOf("run `phases/merge.md` step 0, which alone decides");
  assert(step0 >= 0 && step0 < a.indexOf("bash .specnaut/scripts/bash/merge-mode.sh"));
  assertStringIncludes(a, 'asked instead of "Ready to merge?", so nothing is asked twice');
  assertStringIncludes(a, "A `NAMES_FILE` listing `.specnaut/workflow.yml` means `manual`");
  assertStringIncludes(a, "is never `auto`");
  const m = flat(phase("merge").content);
  assertStringIncludes(
    m,
    "A `NAMES_FILE` listing `.specnaut/workflow.yml` or `.specnaut/backlog-config.yml`, on any " +
      "run, makes the merge mode `manual`",
  );
});

Deno.test("the board fence is stated once, before any backlog script of the merge", () => {
  const merge = phase("merge").content;
  const fence = merge.indexOf("`VERDICT backlog-config trusted`, no backlog script runs");
  assert(fence >= 0, "merge.md has no board fence");
  assert(fence < merge.indexOf("move.sh"), "move.sh is named before the fence");
  const close = flat(phase("merge-close").content);
  assert(!close.includes("backlog-config.yml"), "merge-close.md restates the fence");
  assertStringIncludes(close, "only past the board fence of `phases/merge.md` step 5");
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
  assertStringIncludes(seats, "`TEST_COUNT` is unknown, counted as above 0");
});

Deno.test("each NAMES_FILE is removed once read: review at its report, merge run by run", () => {
  assertStringIncludes(
    flat(phase("review").content),
    "Produce a final pass/fail report, then `rm -f` each `NAMES_FILE` step 1 printed.",
  );
  assertStringIncludes(
    flat(phase("merge").content),
    "Each run's `NAMES_FILE` is removed (`rm -f`) once the next run prints its own, and the last " +
      "when this phase ends, landed or stopped.",
  );
});
