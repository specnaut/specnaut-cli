import { assert, assertEquals } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";

/**
 * Locks the two halves of feature 012 (machine-readable agent output contracts)
 * together: the four contract skills must ship in the bundle as
 * `user-invocable: false`, AND every wired agent's bundled content must carry
 * the exact `skills:` preload entries from the research.md mapping table. If a
 * contract drops out of the bundle, or an agent loses its preload line, one of
 * these assertions goes red — the contract and its consumers can't drift apart
 * silently (FR-002, SC-001, SC-004).
 */

/** The four contract skills, by bundled `name`. Identity = name (data-model.md). */
const CONTRACT_SKILLS = [
  "workflow-contract",
  "handoff-protocol",
  "review-findings-contract",
  "qa-report-contract",
] as const;

/** Authoritative wired-agent → contracts mapping (research.md). */
const AGENT_WIRING: Record<string, readonly string[]> = {
  "architecture-auditor": ["review-findings-contract", "workflow-contract"],
  "performance-auditor": ["review-findings-contract", "workflow-contract"],
  "security-auditor": ["review-findings-contract", "workflow-contract"],
  "a11y-auditor": ["review-findings-contract", "workflow-contract"],
  "dependency-auditor": ["review-findings-contract", "workflow-contract"],
  "code-reviewer": ["review-findings-contract", "workflow-contract"],
  "test-reviewer": ["review-findings-contract", "workflow-contract"],
  "review-coordinator": ["workflow-contract", "handoff-protocol", "review-findings-contract"],
  "developer": ["workflow-contract", "handoff-protocol"],
  "workflow-manager": ["workflow-contract", "handoff-protocol"],
  "qa-tester": ["qa-report-contract", "workflow-contract"],
};

function skillEntry(name: string): CoreEntry | undefined {
  return CORE_BUNDLE.find((e) => e.category === "skill" && e.name === name);
}

function agentEntry(name: string): CoreEntry | undefined {
  return CORE_BUNDLE.find((e) => e.category === "agent" && e.name === name);
}

/** Extracts the YAML frontmatter block from a bundled markdown file's content. */
function frontmatter(content: string): string {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  assert(m, "expected a leading YAML frontmatter block");
  return m[1];
}

/** Reads the inline comma-list `skills:` frontmatter field, if present. */
function skillsField(frontmatterBody: string): string[] {
  const line = frontmatterBody
    .split("\n")
    .find((l) => /^skills:\s/.test(l));
  assert(line, "expected a `skills:` frontmatter line");
  return line
    .replace(/^skills:\s*/, "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// (a) The four contracts are in CORE_BUNDLE and each is user-invocable: false.
for (const name of CONTRACT_SKILLS) {
  Deno.test(`contract skill "${name}" is bundled as a skill`, () => {
    const entry = skillEntry(name);
    assert(entry, `contract skill "${name}" missing from CORE_BUNDLE`);
  });

  Deno.test(`contract skill "${name}" is user-invocable: false`, () => {
    const entry = skillEntry(name)!;
    const fm = frontmatter(entry.content);
    assert(
      /^user-invocable:\s*false\s*$/m.test(fm),
      `contract "${name}" must declare \`user-invocable: false\` in its frontmatter`,
    );
  });

  Deno.test(`contract skill "${name}" carries name + description`, () => {
    const fm = frontmatter(skillEntry(name)!.content);
    assert(new RegExp(`^name:\\s*${name}\\s*$`, "m").test(fm), "name mismatch");
    assert(/^description:\s+\S/m.test(fm), "expected a one-line description");
  });
}

// (b) Each wired agent's bundled content carries the expected skills: entries.
for (const [agent, expected] of Object.entries(AGENT_WIRING)) {
  Deno.test(`agent "${agent}" preloads ${expected.join(" + ")}`, () => {
    const entry = agentEntry(agent);
    assert(entry, `wired agent "${agent}" missing from CORE_BUNDLE`);
    const got = skillsField(frontmatter(entry.content));
    // Order-insensitive: load order of `skills:` is not a semantic contract,
    // so compare as sets — only the membership matters.
    assertEquals(
      new Set(got),
      new Set(expected),
      `agent "${agent}" skills: frontmatter does not match the research.md mapping`,
    );
  });
}
