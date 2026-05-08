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
  const mapped = h.mapBundle(CORE_BUNDLE, { backlogBackend: "local" });
  // Router skill + 11 phase docs + auto-chain + specflow-review alias +
  // backlog skill + 1 backlog cmd + 9 agents + 5 agent-memory stubs +
  // 16 spec-root entries + AGENTS.md + .gitignore + 5 backlog scripts +
  // .claude/CLAUDE.md + dispatch-agent.sh + loop.md + settings.json + 3 hooks.
  const keys = Object.keys(mapped);
  assert(keys.length > 50, `expected ~58 entries, got ${keys.length}`);
  assert(".claude/skills/specflow/SKILL.md" in mapped);
  assert(".claude/skills/specflow/phases/specify.md" in mapped);
  assert(".claude/skills/specflow/phases/groom.md" in mapped);
  assert(".claude/skills/specflow-review/SKILL.md" in mapped);
  // /backlog stays as a flat command
  assert(".claude/commands/backlog.md" in mapped);
  // Old per-phase skill folders are gone post-consolidation
  assert(!(".claude/skills/specflow-specify/SKILL.md" in mapped));
  assert(!(".claude/skills/specflow-groom/SKILL.md" in mapped));
  assert(!(".claude/commands/specflow-specify.md" in mapped));
  // Bundled assets unchanged
  assert(".claude/loop.md" in mapped);
  assert(".claude/settings.json" in mapped);
  assert(".claude/hooks/protect-generated.sh" in mapped);
  assert(".claude/hooks/log-subagent.sh" in mapped);
  assert(".claude/hooks/check-backlog-prereqs.sh" in mapped);
  assert(".claude/agents/product-owner.md" in mapped);
  assert(".claude/skills/auto-chain/SKILL.md" in mapped);
  assert(".claude/skills/backlog/SKILL.md" in mapped);
  assert(".specflow/scripts/backlog/list.sh" in mapped);
  assert(".specflow/memory/constitution.md" in mapped);
  assert("AGENTS.md" in mapped);
  assert(".claude/CLAUDE.md" in mapped);
  assert(!("CLAUDE.md" in mapped), "CLAUDE.md must not live at project root");
});

Deno.test("ClaudeHarness includes HARNESS_STATIC claude files (.claude/CLAUDE.md)", () => {
  const h = new ClaudeHarness();
  const mapped = h.mapBundle(CORE_BUNDLE, { backlogBackend: "local" });
  const claudeMd = mapped[".claude/CLAUDE.md"];
  const staticClaude = HARNESS_STATIC.claude[".claude/CLAUDE.md"];
  assertEquals(claudeMd?.content, staticClaude?.content);
});
