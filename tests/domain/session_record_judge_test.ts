import { assertEquals } from "@std/assert";
import { CHECKOUT_REASON, type CheckoutWalk } from "../../src/domain/checkout_trust.ts";
import { REASON } from "../../src/domain/script_trust.ts";
import {
  judgeRecord,
  recordOf,
  SESSION_REASON,
  startReasons,
  tipDigests,
} from "../../src/domain/session_record.ts";
import { enc, HEAD, L, MARK, OUTSIDE, S, TIP, WALK } from "./session_record_fixture.ts";

/** The rule that judges a session's record against the base's tip. */

async function judge(
  record: Awaited<ReturnType<typeof recordOf>>,
  headCommits: string[] = [],
  symlinks = true,
) {
  return judgeRecord({
    headCommits,
    untrustedCommits: [OUTSIDE],
    tree: record.tree,
    tip: TIP,
    tipDigests: await tipDigests(TIP, symlinks),
  });
}

Deno.test("a record of the tip holds", async () => {
  assertEquals(await judge(await recordOf(HEAD, MARK, WALK)), { holds: true, reasons: [] });
});

Deno.test("a record whose HEAD holds a commit the tip lacks fails, by rule 1", async () => {
  const verdict = await judge(await recordOf(HEAD, MARK, WALK), [OUTSIDE]);
  assertEquals(verdict.reasons, [{ path: OUTSIDE, reason: CHECKOUT_REASON.headHolds }]);
});

Deno.test("a recorded file whose digest is not the tip's fails, as differing", async () => {
  const walk: CheckoutWalk[] = [{
    kind: "walked",
    entries: [{ kind: "file", path: S, bytes: enc('{"hooks":{}}\n'), links: 1 }],
  }];
  const verdict = await judge(await recordOf(HEAD, MARK, walk));
  assertEquals(verdict.reasons, [
    { path: S, reason: REASON.differs },
    { path: L, reason: REASON.missing },
  ]);
});

Deno.test("a recorded file holding the tip's link target holds, as on disk where links are off", async () => {
  const walk: CheckoutWalk[] = [{
    kind: "walked",
    entries: [
      { kind: "file", path: S, bytes: enc("{}\n"), links: 1 },
      { kind: "file", path: L, bytes: enc("../x"), links: 1 },
    ],
  }];
  assertEquals((await judge(await recordOf(HEAD, MARK, walk), [], false)).holds, true);
});

Deno.test("where git writes links as links, a recorded file holding the tip's link target differs", async () => {
  const walk: CheckoutWalk[] = [{
    kind: "walked",
    entries: [
      { kind: "file", path: S, bytes: enc("{}\n"), links: 1 },
      { kind: "file", path: L, bytes: enc("../x"), links: 1 },
    ],
  }];
  const verdict = await judge(await recordOf(HEAD, MARK, walk), [], true);
  assertEquals(verdict.reasons, [{ path: L, reason: REASON.differs }]);
});

Deno.test("what the record found that the checkout now does not show is marked as found at session start", () => {
  const now = [{ path: S, reason: REASON.differs }];
  const atStart = [{ path: S, reason: REASON.differs }, { path: OUTSIDE, reason: "x" }];
  assertEquals(startReasons(now, atStart), [
    { path: OUTSIDE, reason: `${SESSION_REASON.atStart}: x` },
  ]);
});
