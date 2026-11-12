import { assertEquals } from "@std/assert";
import { reflogSince } from "../../src/domain/session_record.ts";

/**
 * What HEAD's reflog says the session did since its record was taken: the commits of the entries
 * written since the mark, or nothing at all once the mark is no longer where it stood.
 */

const HEAD = "c".repeat(40);

Deno.test("the reflog since the start is every entry past the one it marked, each commit once", () => {
  const [a, b, c] = ["a", "b", "1"].map((x) => x.repeat(40));
  const mark = { entries: 2, newest: a };
  assertEquals(reflogSince(mark, [a, HEAD]), [], "nothing written since");
  assertEquals(reflogSince(mark, [c, b, c, a, HEAD]), [c, b], "newest first, each once");
});

Deno.test("a reflog that no longer shows the entry the start marked tells nothing since", () => {
  const [a, b] = ["a", "b"].map((x) => x.repeat(40));
  const mark = { entries: 2, newest: a };
  assertEquals(reflogSince(mark, [a]), null, "shorter: entries expired");
  assertEquals(reflogSince(mark, [b, a]), null, "as long, but the mark is not where it stood");
  assertEquals(reflogSince(mark, [b, HEAD, a]), null, "an older entry deleted, one written");
});
