import { assertEquals } from "@std/assert";
import { inCheckoutScope, isInstructionFile } from "../../src/domain/checkout_scope.ts";
import {
  exactlyInScope,
  isNested,
  keptAtHead,
  nestedRoots,
} from "../../src/domain/instruction_scope.ts";

/** The instruction files a harness reads below the project's root, at any depth. */

Deno.test("the four names count at any depth, in any letter case, and only below the root", () => {
  const nested = ["a/AGENTS.md", "a/b/c/claude.md", "x/AGENTS.override.md", "y/CLAUDE.local.md"];
  assertEquals(nested.filter((p) => !isInstructionFile(p) || !inCheckoutScope(p)), []);
  const not = ["AGENTS.md", "a/README.md", "a/CLAUDE.md.bak", "a/my-AGENTS.md"];
  assertEquals(not.filter(isInstructionFile), []);
});

Deno.test("a file a root of the class already holds is not nested; others are", () => {
  assertEquals(
    ["src/CLAUDE.md", ".claude/CLAUDE.md", ".claude/skills/x/CLAUDE.md", "docs/AGENTS.md"].map(
      isNested,
    ),
    [true, false, false, true],
  );
  assertEquals([keptAtHead("src/claude.md"), keptAtHead("src/notes.md")], [true, false]);
});

Deno.test("a nested name is exact only as written", () => {
  assertEquals([exactlyInScope("src/CLAUDE.md"), exactlyInScope("src/Claude.md")], [true, false]);
});

Deno.test("each folder holding one is walked once, for the four names", () => {
  const roots = nestedRoots(["a/CLAUDE.md", "a/AGENTS.md", "b/c/AGENTS.md"]);
  assertEquals(roots.map((r) => [r.dir, r.deep, r.names?.length]), [
    ["a", false, 4],
    ["b/c", false, 4],
  ]);
});
