import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  constitutionCeilingNote,
  constitutionOverCeiling,
  DEFAULT_CONSTITUTION_LIMIT,
} from "../../src/domain/size_limits.ts";

/** The constitution's own ceiling (spec 038, FR-016): one judge for `check` and `upgrade`. */

const lines = (n: number) => "x\n".repeat(n);

Deno.test("the constitution default is 60 lines target, 100 ceiling", () => {
  assertEquals(DEFAULT_CONSTITUTION_LIMIT, { target: 60, ceiling: 100 });
});

Deno.test("a constitution at its ceiling is not over it; one line more is", () => {
  assertEquals(constitutionOverCeiling(lines(100)), null);
  assertEquals(constitutionOverCeiling(lines(101)), { lines: 101, ceiling: 100 });
});

Deno.test("lines are counted as wc -l counts them, CRLF included", () => {
  assertEquals(constitutionOverCeiling("x\r\n".repeat(101))?.lines, 101);
  // No trailing newline: wc -l does not count the last line.
  assertEquals(constitutionOverCeiling(lines(100) + "tail"), null);
});

Deno.test("a ceiling of none never warns", () => {
  assertEquals(constitutionOverCeiling(lines(500), { target: null, ceiling: null }), null);
});

Deno.test("the note names the file, the count, the ceiling and the remedy", () => {
  const note = constitutionCeilingNote({ lines: 130, ceiling: 100 });
  assertStringIncludes(note, "docs/constitution.md is 130 lines, over its ceiling of 100");
  assertStringIncludes(note, "shrink it");
});
