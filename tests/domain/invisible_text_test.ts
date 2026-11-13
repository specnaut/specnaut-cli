import { assertEquals } from "@std/assert";
import { invisibleIn } from "../../src/domain/invisible_text.ts";

/**
 * The code points a person reading a diff cannot see: a yes to instruction text is never given
 * over them, so they are named by code point, with the line of the first.
 */

const enc = (s: string) => new TextEncoder().encode(s);

Deno.test("plain text, emoji and accents hold nothing invisible", () => {
  assertEquals(invisibleIn(enc("# Rules\n\nRun every gate. Caf\u{E9} \u{2713}\n")), null);
});

Deno.test("a bidi override, a zero-width space and a tag character are named by code point, with a line", () => {
  assertEquals(invisibleIn(enc("a\nb\u{202E}c\n")), "U+202E (line 2)");
  assertEquals(invisibleIn(enc("x\u{200B}y\u{E0041}z\n")), "U+200B, U+E0041 (line 1)");
});

Deno.test("line and paragraph separators are named", () => {
  assertEquals(invisibleIn(enc("a\u{2028}b\u{2029}c")), "U+2028, U+2029 (line 1)");
});

Deno.test("a byte order mark that opens the file is not, one inside it is", () => {
  assertEquals(invisibleIn(enc("\u{FEFF}# Rules\n")), null);
  assertEquals(invisibleIn(enc("# Rules\n\u{FEFF}x\n")), "U+FEFF (line 2)");
});
