import { assertEquals } from "@std/assert";
import { isReflogMark, reflogMark, reflogSince } from "../../src/domain/head_reflog.ts";
import { sha256HexBytes } from "../../src/domain/sha256.ts";

/**
 * What HEAD's reflog says the session did since its record was taken: the commits of the entries
 * appended after the marked bytes, or nothing at all once those bytes are not where they were.
 */

const [A, B, C, D] = ["a", "b", "c", "d"].map((x) => x.repeat(40));
const ZERO = "0".repeat(40);
/** An entry moving HEAD from `from` to `to`. */
const entry = (from: string, to: string) =>
  `${from} ${to} A U Thor <a@example.com> 1700000000 +0000\tcheckout: moving\n`;
const enc = (s: string) => new TextEncoder().encode(s);
const START = entry(ZERO, A) + entry(A, B);

Deno.test("the mark is the reflog's length and digest; one with no entry, or not whole entries, marks nothing", async () => {
  assertEquals(await reflogMark(enc(START)), {
    bytes: enc(START).length,
    sha256: await sha256HexBytes(enc(START)),
  });
  for (const log of ["", `${START}not an entry\n`, START.slice(0, -1)]) {
    assertEquals(await reflogMark(enc(log)), null, JSON.stringify(log));
  }
  assertEquals(isReflogMark({ bytes: 1, sha256: "f".repeat(64) }), true);
  for (
    const v of [{ bytes: 0, sha256: "f".repeat(64) }, { bytes: 1.5 }, { bytes: 1, sha256: "x" }]
  ) {
    assertEquals(isReflogMark(v), false, JSON.stringify(v));
  }
});

Deno.test("the reflog since the mark names every commit each entry after it moved HEAD to or from, once, newest first", async () => {
  const mark = (await reflogMark(enc(START)))!;
  assertEquals(await reflogSince(mark, enc(START)), [], "nothing appended since");
  const since = entry(B, C) + entry(C, D) + entry(D, ZERO);
  assertEquals(await reflogSince(mark, enc(START + since)), [D, C, B]);
  assertEquals(await reflogSince(mark, enc(START + entry(C, B))), [B, C], "a deleted visit's C");
});

Deno.test("a reflog not beginning with the marked bytes, or followed by anything but entries, tells nothing", async () => {
  const mark = (await reflogMark(enc(START)))!;
  const cases = [
    entry(A, B) + entry(B, C), // an older entry removed
    entry(ZERO, A) + entry(A, D) + entry(D, C), // the marked entry changed
    entry(ZERO, A), // shorter
    "",
    `${START}garbage\n`,
  ];
  for (const log of cases) {
    assertEquals(await reflogSince(mark, enc(log)), null, JSON.stringify(log));
  }
});
