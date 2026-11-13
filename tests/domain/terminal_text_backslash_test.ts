import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { terminalText } from "../../src/domain/terminal_text.ts";
import { changedStagedEntryRefusal } from "../../src/infrastructure/fs_refusals.ts";

/**
 * cli#785: a backslash is doubled only where a reader could take it for the start of an escape —
 * a run of them right before a `u`, or before a character that is about to be shown as `\uXXXX`.
 * Everywhere else it is shown as it is, so a Windows path reads as the user would type it.
 */

Deno.test("terminalText: a Windows path is shown as it is", () => {
  assertEquals(terminalText("C:\\Users\\Ann\\proj\\a.md"), "C:\\Users\\Ann\\proj\\a.md");
  assertEquals(terminalText("\\\\server\\share\\x"), "\\\\server\\share\\x");
});

Deno.test("terminalText: a backslash before a `u` is doubled, so it cannot pass for an escape", () => {
  assertEquals(terminalText("a\\u001bb"), "a\\\\u001bb");
  assertEquals(terminalText("C:\\work\\utils"), "C:\\work\\\\utils");
  assertEquals(terminalText("a\\\\ub"), "a\\\\\\\\ub");
});

Deno.test("terminalText: a backslash before an escaped character is doubled too", () => {
  // `\` + ESC must not read as the literal text `\u001b`, which shows as `\\u001b`.
  assertEquals(terminalText("a\\\x1bb"), "a\\\\\\u001bb");
  assertEquals(terminalText("a\\\x1bb") === terminalText("a\\u001bb"), false);
});

Deno.test("terminalText: what it shows reads back to one name only", () => {
  const names = ["\\u", "\\\x1b", "\\\\u", "u", "\x1b", "\\", "\\\\", "\\\\\x1b", "\\u001b"];
  const shown = names.map(terminalText);
  assertEquals(new Set(shown).size, names.length, JSON.stringify(shown));
});

Deno.test({
  name: "a staged-entry refusal on Windows names the path as the user would type it",
  ignore: Deno.build.os !== "windows",
  fn: async () => {
    const root = await Deno.makeTempDir({ prefix: "Proj-785-" });
    try {
      // The pin below types the one doubled backslash itself, so the temp root must hold none.
      assertEquals(/\\u/.test(root), false, root);
      const abs = join(root, ".specnaut", "upgrade-staging", "Agents", "dev.md");
      const { message } = changedStagedEntryRefusal(root, abs);
      assertStringIncludes(
        message,
        `  path:    ${root}\\.specnaut\\\\upgrade-staging\\Agents\\dev.md\n`,
      );
      assertStringIncludes(message, `  project: ${root}\n`);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});
