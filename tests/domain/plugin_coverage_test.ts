import { assertEquals } from "@std/assert";
import { isPluginCoveredPath } from "../../src/domain/plugin_coverage.ts";

// ── Claude harness — covered paths ─────────────────────────────────────────

Deno.test("isPluginCoveredPath: claude + .claude/agents/<name>.md (non-architect) is covered", () => {
  for (
    const name of [
      "code-reviewer",
      "developer",
      "devops-sre",
      "product-owner",
      "qa-tester",
      "review-coordinator",
      "security-auditor",
      "specnaut-expert",
      "test-reviewer",
      "workflow-manager",
      "ui-ux-designer",
      "performance-auditor",
      "a11y-auditor",
      "architecture-auditor",
      "dependency-auditor",
    ]
  ) {
    assertEquals(
      isPluginCoveredPath("claude", `.claude/agents/${name}.md`),
      true,
      `agent ${name} should be plugin-covered`,
    );
  }
});

Deno.test("isPluginCoveredPath: claude + architect.md is NOT covered (contributor-only)", () => {
  assertEquals(
    isPluginCoveredPath("claude", ".claude/agents/architect.md"),
    false,
  );
});

Deno.test("isPluginCoveredPath: claude + .claude/skills/specnaut/SKILL.md (router) is covered", () => {
  assertEquals(
    isPluginCoveredPath("claude", ".claude/skills/specnaut/SKILL.md"),
    true,
  );
});

Deno.test("isPluginCoveredPath: claude + .claude/skills/specnaut/phases/<phase>.md is covered", () => {
  for (
    const name of [
      "specify",
      "plan",
      "tasks",
      "implement",
      "analyze",
      "review",
      "merge",
      "constitution",
      "checklist",
      "clarify",
      "groom",
    ]
  ) {
    assertEquals(
      isPluginCoveredPath(
        "claude",
        `.claude/skills/specnaut/phases/${name}.md`,
      ),
      true,
      `phase ${name} should be plugin-covered`,
    );
  }
});

// Hyphenated phase names — the previous `[a-z]+` regex silently failed
// for these. Locked in by Epic #302 / #303 (which added audit-security).
Deno.test("isPluginCoveredPath: claude + hyphenated phase names are covered", () => {
  for (
    const name of [
      "tag-version",
      "release-version",
      "list-skills",
      "audit-security",
      "audit-performance",
      "audit-accessibility",
      "audit-architecture",
      "audit-dependencies",
    ]
  ) {
    assertEquals(
      isPluginCoveredPath(
        "claude",
        `.claude/skills/specnaut/phases/${name}.md`,
      ),
      true,
      `hyphenated phase ${name} should be plugin-covered`,
    );
  }
});

Deno.test("isPluginCoveredPath: claude + specnaut-auto skill is covered", () => {
  assertEquals(
    isPluginCoveredPath("claude", ".claude/skills/specnaut-auto/SKILL.md"),
    true,
  );
});

Deno.test("isPluginCoveredPath: claude + specnaut-review alias is covered", () => {
  assertEquals(
    isPluginCoveredPath("claude", ".claude/skills/specnaut-review/SKILL.md"),
    true,
  );
});

// ── Claude harness — NOT covered paths ────────────────────────────────────

Deno.test("isPluginCoveredPath: claude + project-stateful paths NOT covered", () => {
  for (
    const dest of [
      ".specnaut/installed.lock",
      ".specnaut/memory/constitution.md",
      ".specnaut/backlog.md",
      ".specnaut/backlog-config.yml",
      ".specnaut/scripts/backlog/add.sh",
      "AGENTS.md",
      "CLAUDE.md",
      ".gitignore",
    ]
  ) {
    assertEquals(
      isPluginCoveredPath("claude", dest),
      false,
      `${dest} should NOT be plugin-covered (project-stateful)`,
    );
  }
});

Deno.test("isPluginCoveredPath: claude + harness-static paths NOT covered", () => {
  for (
    const dest of [
      ".claude/settings.json",
      ".claude/settings.local.json",
      ".claude/hooks/protect-generated.sh",
      ".claude/hooks/log-subagent.sh",
      ".claude/hooks/check-backlog-prereqs.sh",
      ".claude/loop.md",
      ".claude/scripts/dispatch-agent.sh",
    ]
  ) {
    assertEquals(
      isPluginCoveredPath("claude", dest),
      false,
      `${dest} should NOT be plugin-covered (harness-static)`,
    );
  }
});

Deno.test("isPluginCoveredPath: claude + backlog skill NOT covered (project-stateful)", () => {
  assertEquals(
    isPluginCoveredPath("claude", ".claude/skills/backlog/SKILL.md"),
    false,
  );
});

// ── Other harnesses — never covered ───────────────────────────────────────

Deno.test("isPluginCoveredPath: non-claude harnesses are never covered (plugin is Claude-only)", () => {
  for (
    const harness of [
      "cursor",
      "codex",
      "windsurf",
      "copilot",
      "opencode",
    ] as const
  ) {
    // Even paths that would be covered under claude
    assertEquals(
      isPluginCoveredPath(harness, ".claude/agents/product-owner.md"),
      false,
      `${harness} should never have plugin-covered files`,
    );
    assertEquals(
      isPluginCoveredPath(harness, ".claude/skills/specnaut/SKILL.md"),
      false,
    );
  }
});
