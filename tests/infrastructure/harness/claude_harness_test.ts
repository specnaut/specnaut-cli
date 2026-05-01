import { assert, assertEquals } from "@std/assert";
import { ClaudeHarness } from "../../../src/infrastructure/harness/claude_harness.ts";
import { CORE_BUNDLE, HARNESS_STATIC } from "../../../src/templates_bundle.ts";

Deno.test("ClaudeHarness.key and displayName", () => {
  const h = new ClaudeHarness();
  assertEquals(h.key, "claude");
  assertEquals(h.displayName, "Claude Code");
});

Deno.test("ClaudeHarness.mapBundle emits the Claude tree", () => {
  const h = new ClaudeHarness();
  const mapped = h.mapBundle(CORE_BUNDLE);
  const keys = Object.keys(mapped).sort();
  assertEquals(keys.length, 39); // 38 core + CLAUDE.md
  // Spot-check canonical paths
  assert(".claude/commands/specflow.specify.md" in mapped);
  assert(".claude/commands/backlog.md" in mapped);
  assert(".claude/agents/product-owner.md" in mapped);
  assert(".claude/skills/auto-chain/SKILL.md" in mapped);
  assert(".specflow/memory/constitution.md" in mapped);
  assert("AGENTS.md" in mapped);
  assert("CLAUDE.md" in mapped);
});

Deno.test("ClaudeHarness includes HARNESS_STATIC claude files (CLAUDE.md)", () => {
  const h = new ClaudeHarness();
  const mapped = h.mapBundle(CORE_BUNDLE);
  const claudeMd = mapped["CLAUDE.md"];
  const staticClaude = HARNESS_STATIC.claude["CLAUDE.md"];
  assertEquals(claudeMd?.content, staticClaude?.content);
});
