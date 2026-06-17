import { assert, assertEquals } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";

/**
 * Locks the per-agent `effort` tuning rubric (feature 016, #382).
 *
 * Every bundled agent must carry exactly one `effort:` ∈ {low, medium, high,
 * xhigh} (SC-001), no Sonnet-pinned agent may carry `xhigh` (SC-002, the
 * model-compatibility invariant — `xhigh` is Opus-only), and each agent's
 * value must match the authoritative assignment in
 * `contracts/effort-map.md` (no drift between the contract and the shipped
 * frontmatter).
 */

const VALID_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
type Effort = (typeof VALID_EFFORTS)[number];

/**
 * Authoritative agent → effort assignment, mirroring
 * `.specnaut/specs/016-agent-effort-rubric/contracts/effort-map.md`.
 * 2 low · 9 medium · 1 high · 3 xhigh = 15.
 */
const EFFORT_MAP: Record<string, Effort> = {
  "review-coordinator": "low",
  "workflow-manager": "low",
  "a11y-auditor": "medium",
  "architecture-auditor": "medium",
  "dependency-auditor": "medium",
  "performance-auditor": "medium",
  "security-auditor": "medium",
  "code-reviewer": "medium",
  "test-reviewer": "medium",
  "specnaut-expert": "medium",
  "product-owner": "medium",
  "ui-ux-designer": "high",
  "developer": "xhigh",
  "qa-tester": "xhigh",
  "devops-sre": "xhigh",
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

// SC-002: no Sonnet-pinned agent carries `xhigh` (xhigh is Opus-only).
for (const entry of agentEntries()) {
  Deno.test(`agent "${entry.name}" respects xhigh⇒Opus`, () => {
    const fm = frontmatter(entry.content);
    const effort = scalarField(fm, "effort");
    const model = scalarField(fm, "model");
    if (effort === "xhigh") {
      assertEquals(
        model,
        "opus",
        `agent "${entry.name}" has effort: xhigh but model: ${model} — xhigh is Opus-only`,
      );
    }
  });
}

// The bundled value matches the authoritative effort-map.md assignment.
for (const [name, expected] of Object.entries(EFFORT_MAP)) {
  Deno.test(`agent "${name}" effort matches effort-map.md (${expected})`, () => {
    const entry = agentEntries().find((e) => e.name === name);
    assert(entry, `agent "${name}" missing from CORE_BUNDLE`);
    const value = scalarField(frontmatter(entry.content), "effort");
    assertEquals(value, expected, `agent "${name}" effort drifted from the contract`);
  });
}

// The contract covers exactly the bundled fleet — no agent unclassified,
// no stale entry in the map (guards against a future agent added without an
// effort assignment, per the spec's edge case).
Deno.test("effort-map.md covers exactly the bundled agent fleet", () => {
  const bundled = agentEntries().map((e) => e.name).sort();
  const mapped = Object.keys(EFFORT_MAP).sort();
  assertEquals(bundled, mapped);
});
