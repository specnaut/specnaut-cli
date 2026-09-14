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
      "security-expert",
      "specnaut-guide",
      "test-reviewer",
      "workflow-manager",
      "ui-ux-designer",
      "performance-expert",
      "accessibility-expert",
      "architect-expert",
      "dependency-expert",
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

Deno.test("isPluginCoveredPath: claude + deprecated specnaut-auto skill is NOT covered", () => {
  // specnaut-auto was removed (#409) — it must no longer count as a covered path.
  assertEquals(
    isPluginCoveredPath("claude", ".claude/skills/specnaut-auto/SKILL.md"),
    false,
  );
});

Deno.test("isPluginCoveredPath: the retired specnaut-review alias is not covered", () => {
  // #534 dropped it from the bundle. Kept as an assertion rather than deleted:
  // a coverage list that still claims a file `specnaut check` will never find
  // reports it missing forever.
  assertEquals(
    isPluginCoveredPath("claude", ".claude/skills/specnaut-review/SKILL.md"),
    false,
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

/**
 * This assertion used to read `board/SKILL.md` is NOT covered, "(project-
 * stateful)". Flipped under specnaut-cli#605, because the reason was never true
 * of the thing it governed.
 *
 * What is project-stateful about `board` is its `scripts/` subtree: those
 * scripts resolve paths relative to their own location, so serving them from a
 * plugin path breaks them. But the scripts are not emitted under
 * `.claude/skills/` at all — they land in `.specnaut/scripts/backlog/` — so
 * this assertion never governed them. It governed the DOCUMENTS, which name
 * only project-root-relative paths and which the plugin has shipped since #571.
 *
 * The documents are covered; the scripts are excluded by the criterion and by
 * `tests/plugin/source-exclusions.txt`, for their own separate reason. Both
 * halves are asserted here so the distinction cannot quietly collapse again.
 */
Deno.test("isPluginCoveredPath: the board skill's documents are covered", () => {
  for (
    const dest of [
      ".claude/skills/board/SKILL.md",
      ".claude/skills/board/groom.md",
      ".claude/skills/board/groom-report.md",
      ".claude/skills/board/spec-autogen.md",
    ]
  ) {
    assertEquals(
      isPluginCoveredPath("claude", dest),
      true,
      `${dest} is a project-independent document the plugin ships`,
    );
  }
});

Deno.test("isPluginCoveredPath: the board skill's SCRIPTS are never covered", () => {
  // The actual project-stateful half, and the reason the old assertion gave.
  // These resolve paths relative to their own location, so a plugin-served copy
  // would break — and they are not `.claude/skills/` destinations anyway.
  for (
    const dest of [
      ".specnaut/scripts/backlog/add.sh",
      ".specnaut/scripts/backlog/detect-fields.sh",
      ".claude/skills/board/scripts/add.sh",
    ]
  ) {
    assertEquals(
      isPluginCoveredPath("claude", dest),
      false,
      `${dest} resolves paths relative to itself and must stay binary-owned`,
    );
  }
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
