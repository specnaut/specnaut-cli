import { assert, assertEquals } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";

/**
 * Locks the per-agent `model` + `effort` tuning rubric.
 *
 * Every bundled agent must carry exactly one `effort:` ∈ {low, medium, high,
 * xhigh}, and each agent's `effort:` and `model:` must match the
 * authoritative assignments below — so moving a seat to another tier is an
 * edit to this file, made on purpose, never a drive-by.
 *
 * The authority is `templates/core/agents/README.md`, not the frozen
 * `016-agent-effort-rubric` spec contract: spec dirs record a decision as it
 * was taken, and this rubric has since been retuned (`high` floor, one Haiku seat).
 */

const VALID_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
type Effort = (typeof VALID_EFFORTS)[number];

/**
 * Authoritative agent → effort assignment, mirroring the tier table in
 * `templates/core/agents/README.md`. 13 high · 2 xhigh = 15.
 */
const EFFORT_MAP: Record<string, Effort> = {
  "review-coordinator": "high",
  "workflow-manager": "high",
  "accessibility-expert": "high",
  "dependency-expert": "high",
  "performance-expert": "high",
  "code-reviewer": "high",
  "test-reviewer": "high",
  "specnaut-guide": "high",
  "product-owner": "high",
  "ui-ux-designer": "high",
  "architect-expert": "xhigh",
  "security-expert": "xhigh",
  "developer": "high",
  "qa-tester": "high",
  "devops-sre": "high",
};

function agentEntries(): CoreEntry[] {
  return CORE_BUNDLE.filter((e) => e.category === "agent");
}

/** Extracts the leading YAML frontmatter block from a bundled markdown file. */
function frontmatter(content: string): string {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  assert(m, "expected a leading YAML frontmatter block");
  return m[1];
}

/** Reads a single scalar frontmatter field (e.g. `effort:` / `model:`). */
function scalarField(frontmatterBody: string, field: string): string | undefined {
  const line = frontmatterBody
    .split("\n")
    .find((l) => new RegExp(`^${field}:\\s`).test(l));
  return line?.replace(new RegExp(`^${field}:\\s*`), "").trim();
}

// SC-001: every bundled agent has exactly one valid `effort:`.
for (const entry of agentEntries()) {
  Deno.test(`agent "${entry.name}" declares exactly one valid effort`, () => {
    const fm = frontmatter(entry.content);
    const matches = fm.split("\n").filter((l) => /^effort:\s/.test(l));
    assertEquals(
      matches.length,
      1,
      `agent "${entry.name}" must declare exactly one \`effort:\` line`,
    );
    const value = scalarField(fm, "effort");
    assert(
      value !== undefined && (VALID_EFFORTS as readonly string[]).includes(value),
      `agent "${entry.name}" effort "${value}" not in {${VALID_EFFORTS.join(", ")}}`,
    );
  });
}

// The bundled value matches the authoritative README.md assignment.
for (const [name, expected] of Object.entries(EFFORT_MAP)) {
  Deno.test(`agent "${name}" effort matches the README rubric (${expected})`, () => {
    const entry = agentEntries().find((e) => e.name === name);
    assert(entry, `agent "${name}" missing from CORE_BUNDLE`);
    const value = scalarField(frontmatter(entry.content), "effort");
    assertEquals(value, expected, `agent "${name}" effort drifted from the contract`);
  });
}

// The contract covers exactly the bundled fleet — no agent unclassified,
// no stale entry in the map (guards against a future agent added without an
// effort assignment, per the spec's edge case).
Deno.test("the effort rubric covers exactly the bundled agent fleet", () => {
  const bundled = agentEntries().map((e) => e.name).sort();
  const mapped = Object.keys(EFFORT_MAP).sort();
  assertEquals(bundled, mapped);
});

/**
 * Authoritative agent → `model:` assignment, mirroring the model table in
 * `templates/core/agents/README.md`: 14 opus · 1 haiku = 15.
 *
 * The rule is "who checks the output?". A seat goes to `haiku` only when the
 * person who asked reads its whole output and nothing downstream treats it as
 * complete. A review lens moved here to save tokens fails by returning fewer
 * findings, which is indistinguishable from clean code — this map is what such
 * a change has to edit, in the open.
 */
const MODEL_MAP: Record<string, "opus" | "haiku"> = {
  "review-coordinator": "opus",
  "workflow-manager": "opus",
  "accessibility-expert": "opus",
  "dependency-expert": "opus",
  "performance-expert": "opus",
  "code-reviewer": "opus",
  "test-reviewer": "opus",
  "specnaut-guide": "haiku",
  "product-owner": "opus",
  "ui-ux-designer": "opus",
  "architect-expert": "opus",
  "security-expert": "opus",
  "developer": "opus",
  "qa-tester": "opus",
  "devops-sre": "opus",
};

for (const [name, expected] of Object.entries(MODEL_MAP)) {
  Deno.test(`agent "${name}" model matches the README rubric (${expected})`, () => {
    const entry = agentEntries().find((e) => e.name === name);
    assert(entry, `agent "${name}" missing from CORE_BUNDLE`);
    const value = scalarField(frontmatter(entry.content), "model");
    assertEquals(value, expected, `agent "${name}" model drifted from the contract`);
  });
}

Deno.test("the model rubric covers exactly the bundled agent fleet", () => {
  const bundled = agentEntries().map((e) => e.name).sort();
  assertEquals(Object.keys(MODEL_MAP).sort(), bundled);
});

/**
 * Authoritative agent → `maxTurns` assignment.
 *
 * Nothing pinned these before, and the gap showed: `specnaut-guide` carried 10
 * — the lowest in the fleet by a factor of two — while its own `review-upgrade`
 * protocol prescribes a seven-step interactive walk with two nested per-item
 * loops, each iteration optionally dispatching a sub-agent and committing. The
 * budget was not merely low against its siblings; it was arithmetically
 * incompatible with the procedure the same file prescribes, and the failure
 * mode is silent: the agent renders an opening line, exhausts the budget, and
 * returns nothing anyone can act on.
 *
 * The tiers, so a new seat can be placed rather than guessed:
 *   20 — a read-only review lens: read the diff, report, stop.
 *   30 — writes, or coordinates a fixed set of lenses.
 *   40 — drives an external surface (a sandbox, a pipeline) with retries.
 *   60 — walks an interactive protocol that dispatches sub-agents.
 *   80 — implements, which is the only seat that edits until tests pass.
 */
const MAX_TURNS_MAP: Record<string, number> = {
  "accessibility-expert": 20,
  "architect-expert": 20,
  "code-reviewer": 20,
  "dependency-expert": 20,
  "performance-expert": 20,
  "security-expert": 20,
  "product-owner": 30,
  "review-coordinator": 30,
  "ui-ux-designer": 30,
  "devops-sre": 40,
  "qa-tester": 40,
  "test-reviewer": 40,
  "specnaut-guide": 60,
  "workflow-manager": 60,
  "developer": 80,
};

for (const [name, expected] of Object.entries(MAX_TURNS_MAP)) {
  Deno.test(`agent "${name}" carries its pinned maxTurns (${expected})`, () => {
    const entry = agentEntries().find((e) => e.name === name);
    assert(entry, `agent "${name}" missing from CORE_BUNDLE`);
    const value = scalarField(frontmatter(entry.content), "maxTurns");
    assertEquals(
      value,
      String(expected),
      `agent "${name}" maxTurns drifted — a budget change is a decision, make it here too`,
    );
  });
}

// Same reasoning as the effort rubric: the population is the bundle, so a seat
// added without a budget fails here rather than shipping on whatever default
// the harness happens to apply.
Deno.test("the maxTurns table covers exactly the bundled agent fleet", () => {
  const bundled = agentEntries().map((e) => e.name).sort();
  assertEquals(bundled, Object.keys(MAX_TURNS_MAP).sort());
});
