import { assertEquals } from "@std/assert";
import { holdsShortName, win32Fold } from "../../src/domain/win32_path.ts";
import { win32Name } from "../../src/domain/tree_names.ts";

/**
 * A path as Win32 opens it: each name without a stream suffix or trailing dots and spaces, in one
 * letter case; and whether one of its names is shaped like an 8.3 short name.
 */

Deno.test("a name is read without its stream suffix, trailing dots and spaces, case folded", () => {
  assertEquals(
    ["AGENTS.md::$DATA", "AGENTS.md:notes", ".Claude.", ".claude ", ".claude. ::$DATA", "x.md"]
      .map(win32Name),
    ["agents.md", "agents.md", ".claude", ".claude", ".claude", "x.md"],
  );
});

Deno.test("a path is folded name by name", () => {
  assertEquals(win32Fold(".claude./Settings.json::$DATA"), ".claude/settings.json");
  assertEquals(win32Fold("docs /constitution.md:x"), "docs/constitution.md");
});

Deno.test("a name shaped like an 8.3 short name is told apart, anywhere in the path", () => {
  const shaped = [
    "CLAUDE~1/settings.json",
    ".claude/SETTIN~1.JSO",
    "src/gitatt~1",
    "a~12/x",
    "docs/CONSTI~1.MD.",
    "CODEX~1::$DATA/config.toml",
  ];
  for (const path of shaped) assertEquals(holdsShortName(path), true, path);
  const plain = ["notes~/x.md", "LONGNAME~1/x", "a~b/x", "~1/x", "x/a.b~1", "x/AB~1.ABCD", "a~"];
  for (const path of plain) assertEquals(holdsShortName(path), false, path);
});
