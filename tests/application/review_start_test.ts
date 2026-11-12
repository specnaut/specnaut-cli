import { assertEquals } from "@std/assert";
import {
  CHANGED_PASS,
  MOVED_PASS,
  NO_PASS,
  STALE_PASS,
  startReview,
} from "../../src/application/review_start.ts";
import type { BranchExport } from "../../src/application/untrusted_review.ts";
import { type CheckoutState, PASS_TTL_MS } from "../../src/domain/review_gate.ts";

const NOW = 5_000_000;
const TIP = "c".repeat(40);
const JUDGED: CheckoutState = { head: "e".repeat(40), ref: "refs/heads/topic", reflog: "f0" };

/**
 * A start whose pass was granted at `granted` (`null`: none) for the base tip `TIP` and the
 * checkout `JUDGED`, while the base's tip is now `tip` and the checkout `now`; what it did, in
 * `done`.
 */
function deps(
  granted: number | null,
  done: string[],
  tip: string | null = TIP,
  now: CheckoutState = JUDGED,
  judged: CheckoutState | null = JUDGED,
) {
  const exported = { sha: "a".repeat(40), keep: () => void done.push("kept") } as BranchExport;
  return {
    pass: {
      take: () =>
        Promise.resolve(void done.push("taken"))
          .then(() => granted === null ? null : { granted, baseTip: TIP, checkout: judged }),
      grant: () => Promise.reject(new Error("unreached")),
      revoke: () => Promise.reject(new Error("unreached")),
    },
    now: () => NOW,
    baseTip: () => Promise.resolve(tip),
    checkout: () => Promise.resolve(now),
    exportBranch: (source: string) =>
      Promise.resolve(void done.push(`export ${source}`)).then(() => exported),
  };
}

Deno.test("a start with no pass, or one past its time, fetches nothing", async () => {
  for (const [granted, why] of [[null, NO_PASS], [NOW - PASS_TTL_MS - 1, STALE_PASS]] as const) {
    const done: string[] = [];
    assertEquals(await startReview(deps(granted, done), "12"), { kind: "refused", why });
    assertEquals(done, ["taken"]);
  }
});

Deno.test("a start on a fresh pass takes it, exports the source and keeps the export", async () => {
  const done: string[] = [];
  const outcome = await startReview(deps(NOW - 1000, done), "origin/topic");
  assertEquals(outcome.kind, "started");
  assertEquals(done, ["taken", "export origin/topic", "kept"]);
});

Deno.test("a pass granted for another base tip, or with no base now, starts nothing", async () => {
  for (const tip of ["d".repeat(40), null]) {
    const done: string[] = [];
    assertEquals(await startReview(deps(NOW - 1000, done, tip), "12"), {
      kind: "refused",
      why: MOVED_PASS,
    });
    assertEquals(done, ["taken"]);
  }
});

Deno.test("a pass for a checkout that no longer reads the same, or for none, starts nothing", async () => {
  const changed: [CheckoutState, CheckoutState | null][] = [
    [{ ...JUDGED, head: "d".repeat(40) }, JUDGED],
    [{ ...JUDGED, ref: "refs/heads/pr-12" }, JUDGED],
    [{ ...JUDGED, ref: null }, JUDGED],
    [{ ...JUDGED, reflog: "f1" }, JUDGED],
    [JUDGED, null],
  ];
  for (const [now, judged] of changed) {
    const done: string[] = [];
    const outcome = await startReview(deps(NOW - 1000, done, TIP, now, judged), "12");
    assertEquals(outcome, { kind: "refused", why: CHANGED_PASS }, JSON.stringify(now));
    assertEquals(done, ["taken"]);
  }
});
