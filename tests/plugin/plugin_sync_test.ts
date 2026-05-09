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
  // 11 phase reference docs, loaded by the router on demand.
  ...[
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
  // Dual-copy agents: 9 sub-agent definitions, each landing as
  // `plugin/agents/<name>.md`. Claude Code resolves agents by file
  // basename in plugin scope; no namespacing needed for invocation
  // (agents are not user-invokable like slash commands).
  ...[
    "code-reviewer",
    "developer",
    "devops-sre",
    "product-owner",
    "qa-tester",
    "review-coordinator",
    "security-auditor",
    "test-reviewer",
    "workflow-manager",
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
