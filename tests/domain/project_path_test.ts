import { assertEquals } from "@std/assert";
import { canonical, climb, fromTop, toProject } from "../../src/domain/project_path.ts";

/** A path relative to a project in a subfolder: climbing above it, and written one way. */

Deno.test("a path climbing above its folder keeps its `..`", () => {
  assertEquals(climb(["a"], "../../b/./c"), ["..", "b", "c"]);
  assertEquals(climb([], "x/../../y"), ["..", "y"]);
});

Deno.test("from the top, a path above the repository's top is none", () => {
  assertEquals(fromTop("app/", "../shared.md"), "shared.md");
  assertEquals(fromTop("app/", "../../shared.md"), null);
  assertEquals(fromTop("", "x/../y.md"), "y.md");
  assertEquals(fromTop("", "."), null);
});

Deno.test("the whole repository is written from the project's folder", () => {
  const paths = ["a/b/x.md", "a/c/y.md", "z.md", "a/b", "a", "a/bb/q.md"];
  assertEquals(paths.map((p) => toProject("a/b/", p)), [
    "x.md",
    "../c/y.md",
    "../../z.md",
    ".",
    "..",
    "../bb/q.md",
  ]);
  assertEquals(toProject("", "docs/x.md"), "docs/x.md");
  for (const p of paths) assertEquals(fromTop("a/b/", toProject("a/b/", p)), p);
});

Deno.test("one file is one path, however it was named", () => {
  assertEquals(canonical("app/", "../app/x.md"), "x.md");
  assertEquals(canonical("app/", "./docs/../x.md"), "x.md");
  assertEquals(canonical("app/", "../shared.md"), "../shared.md");
  assertEquals(canonical("app/", "../../outside.md"), null);
  assertEquals(canonical("", "../x.md"), null);
});
