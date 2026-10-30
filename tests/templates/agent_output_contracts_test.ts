import { assert, assertEquals } from "@std/assert";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import type { CoreEntry } from "../../src/domain/core_bundle.ts";

/**
 * Locks the two halves of feature 012 (machine-readable agent output contracts)
 * together: the contract skills must ship in the bundle as
 * `user-invocable: false`, AND every wired agent's bundled content must carry
 * the exact `skills:` preload entries from the research.md mapping table. If a
 * contract drops out of the bundle, or an agent loses its preload line, one of
 * these assertions goes red — the contract and its consumers can't drift apart
 * silently (FR-002, SC-001, SC-004).
 */

/** The contract skills, by bundled `name`. Identity = name (data-model.md). */
const CONTRACT_SKILLS = [
  "workflow-contract",
  "review-findings-contract",
  "backlog-reference-contract",
  // #562: sections split out of seats that had no duplication left to
  // reclaim. Same shape, same `user-invocable: false`.
  "backlog-frontmatter",
  "specnaut-facts",
] as const;

/**
 * #678: contracts nothing parsed, and agents nothing dispatched. Each must stay
 * out of the bundle — a returning file would ship a block no consumer reads, or
 * a seat no phase calls.
 */
const RETIRED_SKILLS = ["handoff-protocol", "qa-report-contract", "alert-triage-contract"] as const;
const RETIRED_AGENTS = ["workflow-manager", "qa-tester", "devops-sre", "ui-ux-designer"] as const;

/** Authoritative wired-agent → contracts mapping (research.md). */
const AGENT_WIRING: Record<string, readonly string[]> = {
  "architect-expert": ["review-findings-contract", "workflow-contract"],
  "performance-expert": ["review-findings-contract", "workflow-contract"],
  // #678 removed the alert-triage mode (no phase dispatched it) with its
  // contract and the `Bash` grant it alone justified.
  "security-expert": ["review-findings-contract", "workflow-contract"],
  "accessibility-expert": ["review-findings-contract", "workflow-contract"],
  "dependency-expert": ["review-findings-contract", "workflow-contract"],
  // #576: this seat reviews whatever the developer wrote, UI included, so it
  // is where a fixed-width layout is caught after the fact.
  "code-reviewer": ["review-findings-contract", "workflow-contract", "mobile-first-contract"],
  "developer": ["workflow-contract", "backlog-reference-contract", "mobile-first-contract"],
  // The single biggest emitter of backlog references — and, until now, the
  // only wired agent with no `skills:` line at all.
  "product-owner": ["backlog-reference-contract", "backlog-frontmatter"],
  // Same #562 split; this seat had no `skills:` line before #378 and none of
  // its own content asserted before this ticket.
  "specnaut-guide": ["specnaut-facts"],
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

// (a) The contracts are in CORE_BUNDLE and each is user-invocable: false.
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

// (a') The retired contracts and agents are gone from the bundle.
for (const name of RETIRED_SKILLS) {
  Deno.test(`retired contract skill "${name}" is not bundled`, () => {
    assertEquals(skillEntry(name), undefined, `"${name}" was retired under #678`);
  });
}
for (const name of RETIRED_AGENTS) {
  Deno.test(`retired agent "${name}" is not bundled`, () => {
    assertEquals(agentEntry(name), undefined, `"${name}" was retired under #678`);
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
