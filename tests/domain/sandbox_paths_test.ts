import { assertEquals, assertThrows } from "@std/assert";
import {
  ancestors,
  overlaps,
  pathProblem,
  safePath,
  within,
} from "../../src/domain/sandbox_paths.ts";

/** How sandbox paths relate: what lies above them, and what one holds of another. */

Deno.test("ancestors: every folder above each path, the root included, once and sorted", () => {
  assertEquals(ancestors(["/a/b/c"]), ["/", "/a", "/a/b"]);
  assertEquals(ancestors(["/a/b/c", "/a/d"]), ["/", "/a", "/a/b"]);
  assertEquals(ancestors(["/x"]), ["/"]);
  assertEquals(ancestors([]), []);
});

Deno.test("within: a sibling sharing a prefix is not inside", () => {
  assertEquals(within("/home/devtools", "/home/dev"), false);
  assertEquals(within("/home/dev", "/home/devtools"), false);
  assertEquals(within("/home/dev-x/a", "/home/dev"), false);
  assertEquals(within("/home/dev", "/home/dev"), true);
  assertEquals(within("/home/dev/a", "/home/dev"), true);
  assertEquals(within("/home", "/home/dev"), false);
});

Deno.test("overlaps: either way round, never across a shared prefix", () => {
  assertEquals(overlaps("/home/dev", "/home/devtools"), false);
  assertEquals(overlaps("/home/devtools/a", "/home/dev"), false);
  assertEquals(overlaps("/home", "/home/dev"), true);
  assertEquals(overlaps("/home/dev/a", "/home/dev"), true);
});

Deno.test("pathProblem: one reason for each way a path cannot be passed on", () => {
  assertEquals(pathProblem("home/dev"), "is not absolute");
  for (const bad of ['/a"b', "/a\\b", "/a,b", "/a:b", "/a\nb", "/a\u0000", "/a\u007f"]) {
    assertEquals(pathProblem(bad), "holds a character a backend cannot quote", JSON.stringify(bad));
  }
  assertEquals(pathProblem("/"), "is the root folder");
  for (const bad of ["/a/../b", "/a/./b", "/a//b", "/a/b/"]) {
    assertEquals(pathProblem(bad), "is not in plain form", bad);
  }
  assertEquals(pathProblem("/home/dev/.cache/x"), null);
});

Deno.test("safePath: hands a plain path back, and throws with the reason otherwise", () => {
  assertEquals(safePath("/usr/bin"), "/usr/bin");
  assertThrows(() => safePath("/a,b"), Error, "cannot quote");
});
