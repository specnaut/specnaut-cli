import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

/**
 * Plugin → source-of-truth byte-identical contract.
 *
 * Each row maps a plugin asset to its bundled source. The plugin must be
 * a verbatim copy: any divergence breaks the user-visible UX guarantee
 * that `specflow init`-scaffolded commands and the plugin-installed
 * versions behave identically. `plugin/skills/` and `plugin/agents/` are
 * excluded from `deno fmt` (see deno.json) so this contract holds
 * against rewraps.
 */
const SYNC_PAIRS: ReadonlyArray<{ plugin: string; source: string }> = [
  // Consolidated router skill (v1.0.0).
  {
    plugin: "plugin/skills/specflow/SKILL.md",
    source: "templates/core/skills/specflow/SKILL.md",
  },
  // 21 phase reference docs, loaded by the router on demand. The
  // phase-1 audit trio (`audit-security` #303, `audit-performance` #304,
  // `audit-accessibility` #305) shipped in v1.9.0; the phase-2 pair
  // (`audit-architecture` #321 + `audit-dependencies` #322) closes
  // Epic #320. `lite-heuristic` (#346) is a contract doc consulted by
  // `phases/specify.md` when CHAIN_SHAPE == auto — not a phase itself,
  // but synced through the same byte-identical channel. `brainstorm`
  // (#351) is the optional step-0 spec-discovery front-end.
  ...[
    "brainstorm",
    "specify",
    "clarify",
    "plan",
    "tasks",
    "analyze",
    "implement",
    "review",
    "merge",
    "constitution",
    "checklist",
    "groom",
    "tag-version",
    "release-version",
    "list-skills",
    "audit-security",
    "audit-performance",
    "audit-accessibility",
    "audit-architecture",
    "audit-dependencies",
    "lite-heuristic",
  ].map((name) => ({
    plugin: `plugin/skills/specflow/phases/${name}.md`,
    source: `templates/core/skills/specflow/phases/${name}.md`,
  })),
  // Auto-chain stays as a separate skill (own slash-command identity).
  {
    plugin: "plugin/skills/specflow-auto/SKILL.md",
    source: "templates/core/skills/specflow-auto/SKILL.md",
  },
  // Thin alias preserving auto-invocation for the review phase.
  {
    plugin: "plugin/skills/specflow-review/SKILL.md",
    source: "templates/core/skills/specflow-review/SKILL.md",
  },
  // writing-plans skill — Specflow's native equivalent of obra/superpowers
  // writing-plans, used for issue-driven planning where the spec-kit
  // /specflow plan ceremony would be overkill (Epic #270, A1 #271).
  {
    plugin: "plugin/skills/writing-plans/SKILL.md",
    source: "templates/core/skills/writing-plans/SKILL.md",
  },
  // requesting-code-review skill — canonical reviewer prompt template +
  // dispatch guide for Specflow's bundled code-reviewer agent. Foundation
  // for the two-stage review pattern used by subagent-driven-development
  // (Epic #270, A3 #273).
  {
    plugin: "plugin/skills/requesting-code-review/SKILL.md",
    source: "templates/core/skills/requesting-code-review/SKILL.md",
  },
  // using-specflow bootstrap skill + 6 tool-mapping references — loaded
  // by the SessionStart hook (plugin/hooks/) to make the agent
  // skill-aware on every turn. Per-harness references already shipped
  // in #283; mirror covers them all for the plugin distribution
  // (Epic #270, B6 #282).
  {
    plugin: "plugin/skills/using-specflow/SKILL.md",
    source: "templates/core/skills/using-specflow/SKILL.md",
  },
  // subagent-driven-development — per-task two-stage review loop
  // (spec compliance then code quality) that consumes plans produced
  // by writing-plans and the canonical reviewer prompt template from
  // requesting-code-review (Epic #270, A2 #272).
  {
    plugin: "plugin/skills/subagent-driven-development/SKILL.md",
    source: "templates/core/skills/subagent-driven-development/SKILL.md",
  },
  // executing-plans — inline alternative to subagent-driven-development
  // for trivial plans where dispatch overhead exceeds the catch rate
  // (Epic #270, A4 #274).
  {
    plugin: "plugin/skills/executing-plans/SKILL.md",
    source: "templates/core/skills/executing-plans/SKILL.md",
  },
  // verification-before-completion — discipline checklist that
  // implementing agents MUST run before claiming DONE (Epic #270,
  // A5 #275).
  {
    plugin: "plugin/skills/verification-before-completion/SKILL.md",
    source: "templates/core/skills/verification-before-completion/SKILL.md",
  },
  // brainstorming — spec-discovery entry point. One question at a
  // time, propose 2-3 approaches, present design for approval, hand
  // off to writing-plans (Epic #270, A6 #276).
  {
    plugin: "plugin/skills/brainstorming/SKILL.md",
    source: "templates/core/skills/brainstorming/SKILL.md",
  },
  // Four machine-readable output-contract skills (#378). `user-invocable:
  // false` — never user-invoked; preloaded into agent context via the
  // `skills:` frontmatter to normalize the WORKFLOW STATUS / HANDOFF /
  // REVIEW SUMMARY / QA SUMMARY blocks agents emit after their prose.
  ...[
    "workflow-contract",
    "handoff-protocol",
    "review-findings-contract",
    "qa-report-contract",
  ].map((name) => ({
    plugin: `plugin/skills/${name}/SKILL.md`,
    source: `templates/core/skills/${name}/SKILL.md`,
  })),
  ...[
    "claude",
    "codex",
    "cursor",
    "opencode",
    "copilot",
  ].map((name) => ({
    plugin: `plugin/skills/using-specflow/references/${name}-tools.md`,
    source: `templates/core/skills/using-specflow/references/${name}-tools.md`,
  })),
  // Dual-copy agents: 15 sub-agent definitions, each landing as
  // `plugin/agents/<name>.md`. Claude Code resolves agents by file
  // basename in plugin scope; no namespacing needed for invocation
  // (agents are not user-invokable like slash commands).
  // Counts: 10 original + ui-ux-designer (#198, sync-test drift fix in
  // #321) + performance-auditor (#304) + a11y-auditor (#305) +
  // architecture-auditor (#321) + dependency-auditor (#322) = 15.
  ...[
    "code-reviewer",
    "developer",
    "devops-sre",
    "product-owner",
    "qa-tester",
    "review-coordinator",
    "security-auditor",
    "specflow-expert",
    "test-reviewer",
    "workflow-manager",
    "ui-ux-designer",
    "performance-auditor",
    "a11y-auditor",
    "architecture-auditor",
    "dependency-auditor",
  ].map((name) => ({
    plugin: `plugin/agents/${name}.md`,
    source: `templates/core/agents/${name}.md`,
  })),
];

function abs(rel: string): string {
  return fromFileUrl(new URL(`../../${rel}`, import.meta.url));
}

for (const pair of SYNC_PAIRS) {
  Deno.test(`${pair.plugin} is byte-identical to ${pair.source}`, async () => {
    const [plugin, source] = await Promise.all([
      Deno.readTextFile(abs(pair.plugin)),
      Deno.readTextFile(abs(pair.source)),
    ]);
    assertEquals(
      plugin,
      source,
      `Plugin copy of ${pair.plugin} has drifted from ${pair.source}. ` +
        `Either: (a) re-copy the source over the plugin file, ` +
        `or (b) if the divergence is intentional, drop this pair from SYNC_PAIRS and document why.`,
    );
  });
}

Deno.test(
  "plugin/.claude-plugin/plugin.json declares name 'specflow-plugin'",
  async () => {
    const manifest = JSON.parse(
      await Deno.readTextFile(abs("plugin/.claude-plugin/plugin.json")),
    );
    assertEquals(manifest.name, "specflow-plugin");
    assertEquals(typeof manifest.description, "string");
    assertEquals(typeof manifest.version, "string");
  },
);
