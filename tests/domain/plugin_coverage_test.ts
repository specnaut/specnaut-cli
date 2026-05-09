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
      "specflow-expert",
      "test-reviewer",
      "workflow-manager",
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

Deno.test("isPluginCoveredPath: claude + .claude/skills/specflow/SKILL.md (router) is covered", () => {
  assertEquals(
    isPluginCoveredPath("claude", ".claude/skills/specflow/SKILL.md"),
    true,
  );
});

Deno.test("isPluginCoveredPath: claude + .claude/skills/specflow/phases/<phase>.md is covered", () => {
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
        `.claude/skills/specflow/phases/${name}.md`,
      ),
      true,
      `phase ${name} should be plugin-covered`,
    );
  }
});

Deno.test("isPluginCoveredPath: claude + specflow-auto skill is covered", () => {
  assertEquals(
    isPluginCoveredPath("claude", ".claude/skills/specflow-auto/SKILL.md"),
    true,
  );
});

Deno.test("isPluginCoveredPath: claude + specflow-review alias is covered", () => {
  assertEquals(
    isPluginCoveredPath("claude", ".claude/skills/specflow-review/SKILL.md"),
    true,
  );
});

// ── Claude harness — NOT covered paths ────────────────────────────────────

Deno.test("isPluginCoveredPath: claude + project-stateful paths NOT covered", () => {
  for (
    const dest of [
      ".specflow/installed.lock",
      ".specflow/memory/constitution.md",
      ".specflow/backlog.md",
      ".specflow/backlog-config.yml",
      ".specflow/scripts/backlog/add.sh",
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
      "gemini",
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
      isPluginCoveredPath(harness, ".claude/skills/specflow/SKILL.md"),
      false,
    );
  }
});
