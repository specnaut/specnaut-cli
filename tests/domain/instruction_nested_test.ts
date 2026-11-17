import { assertEquals } from "@std/assert";
import { inCheckoutScope, isNestedSurface } from "../../src/domain/checkout_scope.ts";
import {
  exactlyInScope,
  isNested,
  keptAtHead,
  nestedRoots,
} from "../../src/domain/instruction_scope.ts";

/** The instruction files a harness reads below the project's root, at any depth. */

Deno.test("the nested names count at any depth, in any letter case, and only below the root", () => {
  const nested = [
    "a/AGENTS.md",
    "a/b/c/claude.md",
    "x/AGENTS.override.md",
    "y/CLAUDE.local.md",
    "z/.GitAttributes",
  ];
  assertEquals(nested.filter((p) => !isNestedSurface(p) || !inCheckoutScope(p)), []);
  const not = ["AGENTS.md", "a/README.md", "a/CLAUDE.md.bak", "a/my-AGENTS.md", "a/.lfsconfig"];
  assertEquals(not.filter(isNestedSurface), []);
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
  assertEquals(exactlyInScope("src/.gitattributes"), true);
});

Deno.test("each folder holding one is walked once, for the nested names", () => {
  const roots = nestedRoots(["a/CLAUDE.md", "a/AGENTS.md", "b/c/.gitattributes"]);
  assertEquals(roots.map((r) => [r.dir, r.deep, r.names?.includes(".gitattributes")]), [
    ["a", false, true],
    ["b/c", false, true],
  ]);
});
