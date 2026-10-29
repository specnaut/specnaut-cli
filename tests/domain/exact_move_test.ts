import { assertEquals } from "@std/assert";
import { judgeExactMove } from "../../src/domain/exact_move.ts";
import type { DiskEntry } from "../../src/domain/context_link.ts";

/**
 * Spec 038 (A-M2): one judgement of "is this move exact", shared by every
 * mover. Each case pins one refusal, and the precedence between them: what is
 * wrong with the source is said before what is in the way at the target.
 */

const file = (content: string): DiskEntry => ({ kind: "file", content });
const lossy: DiskEntry = { kind: "file", content: "step\n�", lossy: true };
const link: DiskEntry = { kind: "symlink", target: "../.env.local", resolved: ".env.local" };

Deno.test("nothing at the source: nothing to move", () => {
  assertEquals(judgeExactMove(null, null), { kind: "no-source" });
  assertEquals(judgeExactMove(null, file("theirs")), { kind: "no-source" });
});

Deno.test("a regular, exactly decoded source and a free target: the move carries its bytes", () => {
  assertEquals(judgeExactMove(file("ours\r\n"), null), { kind: "ok", content: "ours\r\n" });
});

Deno.test("anything at the target refuses the move", () => {
  assertEquals(judgeExactMove(file("ours"), file("theirs")), { kind: "target-occupied" });
  assertEquals(judgeExactMove(file("ours"), link), { kind: "target-occupied" });
});

Deno.test("a link at the source is never copied through", () => {
  assertEquals(judgeExactMove(link, null), { kind: "source-link" });
});

Deno.test("a source whose bytes are not UTF-8 is never moved", () => {
  assertEquals(judgeExactMove(lossy, null), { kind: "source-lossy" });
});

Deno.test("the source is judged before the target", () => {
  assertEquals(judgeExactMove(link, file("theirs")), { kind: "source-link" });
  assertEquals(judgeExactMove(lossy, file("theirs")), { kind: "source-lossy" });
});
