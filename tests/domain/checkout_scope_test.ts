import { assertEquals } from "@std/assert";
import { inCheckoutScope } from "../../src/domain/checkout_trust.ts";

/** Which paths the checkout check compares with the base: the files a session or a review reads. */

Deno.test("the checked files: harness settings, instructions, Specnaut config, version managers", () => {
  const inside = [
    ".claude/settings.json",
    ".claude/settings.local.json",
    ".claude/skills/task/phases/review.md",
    ".codex/config.toml",
    ".agents/skills/task/SKILL.md",
    "CLAUDE.md",
    "claude.md",
    "AGENTS.md",
    ".mcp.json",
    ".specnaut/workflow.yml",
    ".specnaut/size-limits.yml",
    ".specnaut/boundaries.yml",
    ".specnaut/backlog-config.yml",
    ".specnaut/gates.yml",
    ".specnaut/feature.json",
    ".specnaut/hooks/guard.sh",
    ".specnaut/addenda/task/review.md",
    ".specnaut/memory/security/patterns.md",
    "docs/constitution.md",
    ".tool-versions",
    "mise.toml",
    ".mise.toml",
    ".config/mise/config.toml",
    ".envrc",
  ];
  const outside = [
    ".specnaut/scripts/bash/git-read.sh",
    ".specnaut/specs/001-x/plan.md",
    ".specnaut/logs/agents.jsonl",
    "src/CLAUDE.md.ts",
    "README.md",
    "docs/guide.md",
    ".claudeignore/x",
  ];
  assertEquals(inside.filter((p) => !inCheckoutScope(p)), []);
  assertEquals(outside.filter(inCheckoutScope), []);
});
