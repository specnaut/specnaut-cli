import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  frontmatterField,
  frontmatterTools,
  splitFrontmatter,
} from "../../../src/infrastructure/harness/frontmatter.ts";

Deno.test("splitFrontmatter: returns parts when frontmatter present", () => {
  const out = splitFrontmatter(
    "---\nname: thing\ndescription: useful\n---\n\n# Body\n\nText.\n",
  );
  assert(out !== null);
  assert(out.fmBody.includes("name: thing"));
  assert(out.fmBody.includes("description: useful"));
  assertEquals(out.rest.trimStart().startsWith("# Body"), true);
});

Deno.test("splitFrontmatter: returns null when no frontmatter", () => {
  assertEquals(splitFrontmatter("just markdown\n"), null);
  assertEquals(splitFrontmatter(""), null);
});

Deno.test("frontmatterField: extracts a present key", () => {
  const fmBody = "name: thing\ndescription: a useful thing\n";
  assertEquals(frontmatterField(fmBody, "name"), "thing");
  assertEquals(frontmatterField(fmBody, "description"), "a useful thing");
});

Deno.test("frontmatterField: returns null when key absent", () => {
  const fmBody = "name: thing\n";
  assertEquals(frontmatterField(fmBody, "description"), null);
});

Deno.test("frontmatterField: handles block scalar (|)", () => {
  const fmBody = "description: |\n  Line one.\n  Line two.\n";
  const value = frontmatterField(fmBody, "description");
  assertEquals(typeof value, "string");
  assert(value!.includes("Line one"));
  assert(value!.includes("Line two"));
});

Deno.test("frontmatterField: returns null for non-string values", () => {
  const fmBody = "count: 5\nflag: true\n";
  assertEquals(frontmatterField(fmBody, "count"), null);
  assertEquals(frontmatterField(fmBody, "flag"), null);
});

// Every caller reads a bundled agent, and a grant read off broken YAML as "no tools line" would
// render as the harness default: every tool. Broken frontmatter is a defect to stop on.
Deno.test("frontmatterField: malformed YAML throws, naming the key, never reads as absent", () => {
  assertThrows(() => frontmatterField("tools: [Read, Grep\n", "tools"), Error, "tools");
});

// A grant written as a YAML list, or left empty, is not "no tools line": read as one, it renders
// as the harness default.
Deno.test("frontmatterTools: a tools key that is not a string throws; absent is null", () => {
  for (const fm of ["tools: [Read, Grep]\n", "tools:\n", "tools: 3\n", "tools:\n  - Read\n"]) {
    assertThrows(() => frontmatterTools(fm), Error, "tools", JSON.stringify(fm));
  }
  assertEquals(frontmatterTools("tools: Read, Grep\n"), "Read, Grep");
  assertEquals(frontmatterTools("name: x\n"), null);
});
