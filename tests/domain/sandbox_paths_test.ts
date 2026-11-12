import { assertEquals } from "@std/assert";
import { ancestors } from "../../src/domain/sandbox_paths.ts";

/** How sandbox paths relate: what lies above them, and what one holds of another. */

Deno.test("ancestors: every folder above each path, the root included, once and sorted", () => {
  assertEquals(ancestors(["/a/b/c"]), ["/", "/a", "/a/b"]);
  assertEquals(ancestors(["/a/b/c", "/a/d"]), ["/", "/a", "/a/b"]);
  assertEquals(ancestors(["/x"]), ["/"]);
  assertEquals(ancestors([]), []);
});
