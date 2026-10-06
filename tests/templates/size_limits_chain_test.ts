import { assert } from "@std/assert";
import { fromFileUrl } from "@std/path";

/**
 * Each phase of the chain carries its size gate (#644). Before it, nothing from
 * plan to review read the constitution's size limits, so a file grew past any
 * cap through many small slices, each passing every phase.
 *
 * These pin the gate's presence where a reader of that phase will meet it, not
 * its wording: the wording lives once, in `.specnaut/memory/size-limits.md`.
 */

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
// A Windows checkout converts LF to CRLF; several assertions span a line break.
const read = async (p: string) => (await Deno.readTextFile(`${ROOT}${p}`)).replaceAll("\r\n", "\n");
const LIMITS = ".specnaut/memory/size-limits.md";

Deno.test("plan: the template has the mandatory size row and a measured Files touched table", async () => {
  const t = await read("templates/core/specnaut/templates/plan-template.md");
  assert(t.includes("| Size limits ("), "mandatory size row");
  assert(t.includes("### Files touched"), "Files touched table");
  assert(t.includes("| File | Lines now | Lines after (est.) | Over target? |"), "table shape");
  assert(t.includes("measured with `wc -l`"), "Lines now is measured");
  assert(
    t.includes("A size violation cannot be accepted here"),
    "complexity tracking refuses size",
  );
});

Deno.test("plan: the phase points at the size gate", async () => {
  assert((await read("templates/core/skills/specnaut/phases/plan.md")).includes(LIMITS));
});

Deno.test("tasks: the phase applies the gate and the template shows the extraction task", async () => {
  const phase = await read("templates/core/skills/specnaut/phases/tasks.md");
  assert(phase.includes(LIMITS) && phase.includes("extraction task"), "phase gate");
  const t = await read("templates/core/specnaut/templates/tasks-template.md");
  assert(t.includes("**Extractions first.**"), "extraction section");
  assert(t.includes("comes after its extraction"), "an addition waits for the extraction");
});

Deno.test("implement: the phase applies the gate, and the gate carries the table into every brief", async () => {
  assert(
    (await read("templates/core/skills/specnaut/phases/implement.md")).includes(
      `${LIMITS}\` § **implement**`,
    ),
  );
  const limits = await read("templates/core/specnaut/memory/size-limits.md");
  assert(limits.includes("in every\nsubagent's dispatch brief"), "brief carries the table");
  assert(limits.includes("`file: before → after (target T, ceiling C)`"), "report shape");
  assert(limits.includes("is a blocker"), "growth blocks the hand-off");
});

Deno.test("review: the coordinator measures base and head and briefs every seat with the table", async () => {
  const c = await read("templates/core/agents/review-coordinator.md");
  assert(c.includes("0. **Measure sizes.**"), "measurement step");
  assert(
    c.includes("size-ratchet.sh --since") && c.includes("--report"),
    "one measurer, base to head",
  );
  assert(c.includes(LIMITS), "table or defaults in the brief");
  const r = await read("templates/core/agents/code-reviewer.md");
  assert(r.includes("`wc -l <before> → <after>`"), "code-reviewer reports the counts");
  const limits = await read("templates/core/specnaut/memory/size-limits.md");
  for (
    const row of [
      "| A unit ends over its ceiling and did not shrink | HIGH |",
      "| A unit already over its target grew | HIGH |",
      "| A unit crosses its target for the first time | MEDIUM |",
    ]
  ) assert(limits.includes(row), row);
});

Deno.test("the ratchet is invoked through bash, and a run that did not happen is never a pass", async () => {
  // A lost executable bit (an archive, a Windows checkout) turns `./script` into exit 126,
  // which no caller would read as "clean" unless the docs say what it means.
  const c = await read("templates/core/agents/review-coordinator.md");
  const g = await read("templates/core/skills/specnaut/phases/quality-gates.md");
  for (const doc of [c, g]) {
    assert(doc.includes("bash .specnaut/scripts/bash/size-ratchet.sh --since"));
  }
  assert(c.includes('never brief "no size data" as clean'), "coordinator");
  assert(g.includes("never a pass"), "quality gates");
});
