import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { renderUnifiedDiff } from "../../src/domain/diff.ts";

Deno.test("renderUnifiedDiff of identical strings returns empty string", () => {
  assertEquals(renderUnifiedDiff("same\ncontent\n", "same\ncontent\n", "a", "b"), "");
});

Deno.test("renderUnifiedDiff shows added line", () => {
  const diff = renderUnifiedDiff("line1\n", "line1\nline2\n", "old", "new");
  assertStringIncludes(diff, "--- old");
  assertStringIncludes(diff, "+++ new");
  assertStringIncludes(diff, "+line2");
});

Deno.test("renderUnifiedDiff shows removed line", () => {
  const diff = renderUnifiedDiff("a\nb\n", "a\n", "old", "new");
  assertStringIncludes(diff, "-b");
});

Deno.test("renderUnifiedDiff shows modified line", () => {
  const diff = renderUnifiedDiff("hello\n", "hi\n", "old", "new");
  assertStringIncludes(diff, "-hello");
  assertStringIncludes(diff, "+hi");
});

Deno.test("renderUnifiedDiff preserves at least one context line", () => {
  const oldText = "a\nb\nc\nd\ne\n";
  const newText = "a\nb\nCHANGED\nd\ne\n";
  const diff = renderUnifiedDiff(oldText, newText, "old", "new");
  assert(diff.includes(" b"));
  assert(diff.includes(" d"));
  assertStringIncludes(diff, "-c");
  assertStringIncludes(diff, "+CHANGED");
});
