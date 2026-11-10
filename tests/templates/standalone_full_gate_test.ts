import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { flat, phase } from "./task_docs.ts";

/**
 * cli#746 — a standalone item's merge runs the `full` tier once before landing,
 * as `quality-gates.md` promised. `merge.md` step 1 holds one paragraph that runs
 * the tier and reads its exits; the epic bullet and the standalone bullet both
 * point at it, so the exit handling is never spelled twice.
 */

const lf = (s: string) => s.replace(/\r\n/g, "\n");
const MERGE = lf(phase("merge").content);
const QG = lf(phase("quality-gates").content);
const LABEL = "**The full tier**";
const POINTER = "run the full tier (**The full tier**, below)";
const PARAGRAPH = MERGE.indexOf(`   ${LABEL} — `);

/** One bullet of step 1's exit list: it ends at the next bullet, the end of the list, or the label. */
function bullet(head: string): string {
  const start = MERGE.indexOf(`   - **${head}`);
  assert(start >= 0, `merge.md lost the bullet: ${head}`);
  const ends = ["\n   - **Exit", "\n\n", `   ${LABEL} — `]
    .map((m) => MERGE.indexOf(m, start + 1))
    .filter((i) => i > start);
  return MERGE.slice(start, Math.min(...ends));
}

function paragraph(): string {
  assert(PARAGRAPH >= 0, "merge.md lost the full-tier paragraph");
  const end = MERGE.indexOf("\n2. **`--pr` only**", PARAGRAPH);
  assert(end > PARAGRAPH, "the full-tier paragraph is not in step 1");
  return MERGE.slice(PARAGRAPH, end);
}

Deno.test("a standalone item runs the full tier before it squashes", () => {
  const standalone = bullet("Exit 14 — standalone");
  const run = standalone.indexOf(POINTER);
  assert(run >= 0, "the standalone bullet does not run the full tier");
  assert(
    run < standalone.indexOf("phases/merge-squash.md"),
    "the tier must run before the squash: a fix after it means squashing again",
  );
});

Deno.test("an epic runs the same paragraph before it folds", () => {
  const epic = bullet("Exit 0 — an epic");
  assertStringIncludes(epic, "do **not** squash");
  const run = epic.indexOf(POINTER);
  assert(run >= 0, "the epic bullet does not run the full tier");
  assert(run < epic.indexOf("phases/epic-fixups.md"), "the tier must run before the fold");
});

Deno.test("the full-tier call and its exits are spelled once, in one paragraph after the list", () => {
  assertEquals(
    MERGE.split("run-gate.sh full --base").length,
    2,
    "the call is spelled more than once",
  );
  const p = paragraph();
  assert(PARAGRAPH > MERGE.indexOf("   - **Exit 0 — an epic**"), "the paragraph precedes the list");
  const f = flat(p);
  assertStringIncludes(f, `${LABEL} — exits 0 and 14 only`);
  assertStringIncludes(f, 'run-gate.sh full --base "$(git merge-base HEAD <base>)"');
  assertStringIncludes(f, "on an epic, as a `--fixup` of the child at fault");
  assertStringIncludes(f, "on a standalone item, as a commit on the branch");
  assertStringIncludes(f, "never escalated, and nothing lands past a failure");
  assertStringIncludes(f, "say which commands left it");
  assertStringIncludes(f, "With `removed: none`, everything was omitted: run it bare");
  assertStringIncludes(f, "neither is ever reported as the full gate");
});

Deno.test("a branch that edits its own gate list asks once, as step 0 does for scripts", () => {
  const f = flat(paragraph());
  const check = f.indexOf(
    'git diff --quiet "$(git merge-base HEAD <base>)" HEAD -- .specnaut/gates.yml',
  );
  assert(check >= 0, "the gates.yml check is gone");
  const ask = f.indexOf("show that diff");
  assert(ask > check, "the diff is not shown once the check fires");
  assert(ask < f.indexOf("run-gate.sh full --base"), "the question must come before the run");
  assertStringIncludes(f, "this run's merge mode is `manual`");
  assertStringIncludes(
    f,
    '*"This branch changes `.specnaut/gates.yml`. Yes runs the branch\'s list as the full tier."*',
  );
  assertStringIncludes(f, "A no stops on the branch, nothing landed.");
  assertStringIncludes(f, "the report names that run as the branch's list, never the base's");
  assert(!f.includes("stop on the branch and name the change"), "the dead-end stop is back");
  assertStringIncludes(f, "A fix never edits `.specnaut/gates.yml`.");
});

Deno.test("quality-gates.md and merge.md say the same of a standalone item", () => {
  const standalone = flat(QG.slice(QG.indexOf("## A standalone item")));
  assertStringIncludes(standalone, "and so does the merge row: the `full` tier, once,");
  assertStringIncludes(standalone, "through `phases/merge.md`");
  const full = flat(QG.slice(QG.indexOf("## `full` — once"), QG.indexOf("## The size ratchet")));
  assertStringIncludes(
    full,
    "A failing full gate, on an epic or on a standalone item, is fixed as `phases/merge.md`'s **The full tier** says.",
  );
  assert(!/fixup commit|child at fault/.test(full), "quality-gates.md restates the fix rule");
  assertStringIncludes(bullet("Exit 14 — standalone"), POINTER);
});

Deno.test("merge-squash.md is said to load on Exit 14, not at a step number", () => {
  const squash = lf(phase("merge-squash").content);
  const router = lf(
    CORE_BUNDLE.find((e) =>
      e.category === "backlog-skill" && e.name === "task" && e.suffix === null
    )
      ?.content ?? "",
  );
  assert(router.length > 0, "the task router is missing");
  for (const [name, text] of [["merge-squash.md", squash], ["SKILL.md", router]]) {
    assert(!text.includes("at its step 4"), `${name} still says step 4`);
  }
  assertStringIncludes(squash, "Loaded by `phases/merge.md` on **Exit 14 — standalone**");
  assertStringIncludes(router, "| `phases/merge-squash.md` | `merge`, on Exit 14 — standalone |");
});
