import { assertEquals, assertStringIncludes } from "@std/assert";
import { extractBlock, mergeIntoFile } from "../../src/domain/merge_block.ts";

Deno.test("merge: greenfield wraps body in the current Specnaut fence", () => {
  const out = mergeIntoFile(null, "node_modules\n", "gitignore");
  assertStringIncludes(out, "# --- Specnaut: gitignore ---");
  assertStringIncludes(out, "# --- End Specnaut: gitignore ---");
});

Deno.test("merge: replacing a current block is idempotent (no duplicate)", () => {
  const first = mergeIntoFile("dist\n", "node_modules", "gitignore");
  const second = mergeIntoFile(first, "node_modules", "gitignore");
  assertEquals(second, first);
  assertEquals((second.match(/# --- Specnaut: gitignore ---/g) ?? []).length, 1);
});

Deno.test("back-compat: a LEGACY Specflow block is replaced in place and re-fenced", () => {
  // Simulate a file written by a pre-rebrand version.
  const legacy = [
    "dist",
    "",
    "# --- Specflow: gitignore ---",
    "old-entry",
    "# --- End Specflow: gitignore ---",
    "",
  ].join("\n");

  const merged = mergeIntoFile(legacy, "new-entry", "gitignore");

  // Legacy fence migrated to the current label — exactly once, no duplicate.
  assertEquals((merged.match(/# --- Specnaut: gitignore ---/g) ?? []).length, 1);
  assertEquals(merged.includes("# --- Specflow: gitignore ---"), false);
  // User content above the block is preserved; body updated.
  assertStringIncludes(merged, "dist");
  assertStringIncludes(merged, "new-entry");
  assertEquals(merged.includes("old-entry"), false);
});

Deno.test("back-compat: extractBlock reads a legacy Specflow block body", () => {
  const legacy = "# --- Specflow: gitignore ---\nbody-line\n# --- End Specflow: gitignore ---";
  assertEquals(extractBlock(legacy, "gitignore"), "body-line");
});
