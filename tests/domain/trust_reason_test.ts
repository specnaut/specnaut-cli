import { assert, assertEquals } from "@std/assert";
import { REASON, refinedReason } from "../../src/domain/trust_reason.ts";

/**
 * The one rule the script, config and instruction checks share to name a mismatch more precisely
 * than their own reason: line endings alone, or the merge base's bytes.
 */

const enc = (s: string) => new TextEncoder().encode(s);
const LF = enc("a\nb\n");
const CRLF = enc("a\r\nb\r\n");

Deno.test("a CR before LF on either side alone is line endings", () => {
  assertEquals(refinedReason(CRLF, { copies: [LF] }, REASON.differs), REASON.lineEndings);
  assertEquals(refinedReason(LF, { copies: [CRLF] }, REASON.differs), REASON.lineEndings);
});

Deno.test("any copy that matches but for line endings names them; an absent copy matches none", () => {
  const other = enc("c\n");
  assertEquals(refinedReason(CRLF, { copies: [undefined, other, LF] }, "x"), REASON.lineEndings);
  assertEquals(refinedReason(CRLF, { copies: [undefined] }, "x"), "x");
});

Deno.test("the merge base's own bytes are behind; line endings are said first", () => {
  const old = enc("a\n");
  assertEquals(refinedReason(old, { copies: [LF], mergeBase: old }, "x"), REASON.behind);
  assertEquals(refinedReason(CRLF, { copies: [LF], mergeBase: CRLF }, "x"), REASON.lineEndings);
});

Deno.test("behind compares raw bytes: the merge base's text with other line endings is not behind", () => {
  assertEquals(refinedReason(CRLF, { copies: [], mergeBase: LF }, "x"), "x");
});

Deno.test("anything else keeps the caller's reason", () => {
  assertEquals(refinedReason(enc("z\n"), { copies: [LF], mergeBase: LF }, "y"), "y");
});

Deno.test("the line-endings reason says what differs, since a diff of it can show nothing", () => {
  assert(REASON.lineEndings.startsWith("line endings differ"), REASON.lineEndings);
  assert(REASON.lineEndings.includes("CR before LF"), REASON.lineEndings);
  assert(REASON.lineEndings.includes("a diff can be empty"), REASON.lineEndings);
});
