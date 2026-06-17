import { assertEquals } from "@std/assert";
import { isAgenticPath, isParentManaged } from "../../src/domain/parent_managed.ts";

Deno.test("isParentManaged: standalone override wins over a providing ancestor", () => {
  assertEquals(isParentManaged("/some/parent", true), false);
});

Deno.test("isParentManaged: null ancestor with no override is not parent-managed", () => {
  assertEquals(isParentManaged(null, false), false);
});

Deno.test("isParentManaged: ancestor set and no override is parent-managed", () => {
  assertEquals(isParentManaged("/some/parent", false), true);
});

Deno.test("isParentManaged: override wins even when ancestor is null", () => {
  assertEquals(isParentManaged(null, true), false);
});

Deno.test("isAgenticPath: .claude/skills/ paths are agentic", () => {
  assertEquals(isAgenticPath(".claude/skills/specnaut/SKILL.md"), true);
});

Deno.test("isAgenticPath: .claude/agents/ paths are agentic", () => {
  assertEquals(isAgenticPath(".claude/agents/developer.md"), true);
});

Deno.test("isAgenticPath: .claude/commands/ paths are agentic", () => {
  assertEquals(isAgenticPath(".claude/commands/specnaut.md"), true);
});

Deno.test("isAgenticPath: .specflow/ paths are not agentic", () => {
  assertEquals(isAgenticPath(".specflow/memory/constitution.md"), false);
  assertEquals(isAgenticPath(".specflow/templates/spec-template.md"), false);
});

Deno.test("isAgenticPath: AGENTS.md is not agentic", () => {
  assertEquals(isAgenticPath("AGENTS.md"), false);
});

Deno.test("isAgenticPath: .gitignore is not agentic", () => {
  assertEquals(isAgenticPath(".gitignore"), false);
});

Deno.test("isAgenticPath: .claude/settings.json is not agentic", () => {
  assertEquals(isAgenticPath(".claude/settings.json"), false);
});

Deno.test("isAgenticPath: .claude/CLAUDE.md is not agentic", () => {
  assertEquals(isAgenticPath(".claude/CLAUDE.md"), false);
});
