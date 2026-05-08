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
  // The auto-chain skill is plugin-only at the destination, but the
  // body is sourced from the bundled core skill so the binary's
  // backwards-compatible scaffold can stay byte-equivalent during
  // the migration period.
  {
    plugin: "plugin/skills/auto-chain/SKILL.md",
    source: "templates/core/skills/auto-chain/SKILL.md",
  },
  // Dual-copy commands: 10 specflow.* sources, each landing as
  // `plugin/skills/<name>/SKILL.md` (the `specflow.` prefix is
  // dropped because the plugin namespace `specflow-plugin:` already
  // disambiguates).
  ...[
    "analyze",
    "checklist",
    "clarify",
    "constitution",
    "implement",
    "merge",
    "plan",
    "review",
    "specify",
    "tasks",
  ].map((name) => ({
    plugin: `plugin/skills/${name}/SKILL.md`,
    source: `templates/core/commands/specflow-${name}.md`,
  })),
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
  // The groom skill: source folder is `templates/core/skills/specflow-groom/`
  // (binary scaffolds it as a project skill with the namespaced short
  // form), but the plugin folder drops the `specflow.` prefix because
  // the plugin namespace `specflow-plugin:` already disambiguates —
  // the plugin command becomes `/specflow-plugin:groom`.
  {
    plugin: "plugin/skills/groom/SKILL.md",
    source: "templates/core/skills/specflow-groom/SKILL.md",
  },
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
