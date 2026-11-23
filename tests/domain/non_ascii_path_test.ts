import { assertEquals } from "@std/assert";
import { asciiSkeleton, holdsNonAscii } from "../../src/domain/non_ascii_path.ts";

/**
 * A name holding a code point outside ASCII is never matched to another name: its ASCII skeleton
 * only says which surface a case-blind disk might open for it, so that the name can be asked about.
 */

Deno.test("a name holding any code point outside ASCII is told apart from an ASCII one", () => {
  assertEquals(
    ["docs/constitution.md", ".Claude/x.md", "a\u017f", "\u0131", "caf\u00e9", "\u200b"].map(
      holdsNonAscii,
    ),
    [false, false, true, true, true, true],
  );
});

Deno.test("the skeleton of an ASCII name is the name folded to lower case", () => {
  assertEquals(asciiSkeleton(".Claude/Settings.JSON"), ".claude/settings.json");
});

Deno.test("U+017F LATIN SMALL LETTER LONG S reads as an s", () => {
  assertEquals(asciiSkeleton("docs/con\u017ftitution.md"), "docs/constitution.md");
});

Deno.test("U+0131 LATIN SMALL LETTER DOTLESS I reads as an i", () => {
  assertEquals(asciiSkeleton(".claude/sett\u0131ngs.json"), ".claude/settings.json");
});

Deno.test("U+1E9E LATIN CAPITAL LETTER SHARP S reads as ss, as full case folding reads it", () => {
  assertEquals(asciiSkeleton(".claude/sub\u1e9eub/AGENTS.md"), ".claude/subssub/agents.md");
  assertEquals(asciiSkeleton("\u1e9e\u00df"), "ssss", "and U+00DF, its small letter");
});

Deno.test("a mark or a code point with no ASCII reading is dropped, as a disk may ignore it", () => {
  assertEquals(asciiSkeleton("CLAUDE\u200b.md"), "claude.md");
  assertEquals(asciiSkeleton("caf\u00e9/\u0418.md"), "cafe/.md");
  assertEquals(asciiSkeleton("\u212aEY/\u0130"), "key/i", "the Kelvin sign and U+0130");
});
