import { assertEquals } from "@std/assert";
import { asWritten } from "../../src/infrastructure/fs_tree_walker.ts";

/** A link's target is judged as git writes it, whatever the platform read it back as. */

Deno.test("a target read on Windows has its backslashes turned into git's forward slashes", () => {
  assertEquals(asWritten("..\\docs\\AGENTS.md", "windows"), "../docs/AGENTS.md");
});

Deno.test("elsewhere a backslash is part of the name and stays, for the check to refuse", () => {
  assertEquals(asWritten("..\\AGENTS.md", "linux"), "..\\AGENTS.md");
  assertEquals(asWritten("..\\AGENTS.md", "darwin"), "..\\AGENTS.md");
});
