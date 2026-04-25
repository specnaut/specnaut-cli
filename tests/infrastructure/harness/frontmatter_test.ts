import { assert, assertEquals } from "@std/assert";
import {
  frontmatterField,
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
