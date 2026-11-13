import { assertEquals, assertRejects } from "@std/assert";
import { UnexpectedHead } from "../../src/application/untrusted_review_ports.ts";
import {
  CHANGED_PASS,
  LOCKED_AFTER_MISMATCH,
  MOVED_PASS,
  NO_PASS,
  NO_SESSION,
  NOT_THIS_COMMAND,
  STALE_PASS,
  startReview,
} from "../../src/application/review_start.ts";
import type { BranchExport } from "../../src/application/untrusted_review.ts";
import { type CheckoutState, PASS_TTL_MS } from "../../src/domain/review_gate.ts";

const NOW = 5_000_000;
const NONCE = "0123456789abcdef".repeat(2);
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
  session = "s-1",
) {
  const exported = {
    sha: "a".repeat(40),
    logs: "/cache/a/logs",
    keep: () => void done.push("kept"),
  } as BranchExport;
  return {
    nonce: NONCE as string | null,
    pass: {
      take: () =>
        Promise.resolve(void done.push("taken"))
          .then(() =>
            granted === null
              ? null
              : { granted, baseTip: TIP, checkout: judged, session, nonce: NONCE }
          ),
      grant: () => Promise.reject(new Error("unreached")),
      revoke: () => Promise.reject(new Error("unreached")),
    },
    now: () => NOW,
    baseTip: () => Promise.resolve(tip),
    checkout: () => Promise.resolve(now),
    lock: (id: string) => Promise.resolve(void done.push(`lock ${id}`)),
    record: (id: string, review: { head: string; logs: string }) =>
      Promise.resolve(void done.push(`record ${id} ${review.head} ${review.logs}`)),
    exportBranch: (source: string, expected?: string) =>
      Promise.resolve(void done.push(`export ${[source, expected].filter(Boolean).join(" ")}`))
        .then(() => exported),
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
  assertEquals(done, [
    "taken",
    "lock s-1",
    "export origin/topic",
    `record s-1 ${"a".repeat(40)} /cache/a/logs`,
    "kept",
  ]);
});

Deno.test("a start hands the head the caller expects to the export", async () => {
  const done: string[] = [];
  const expected = "b".repeat(40);
  assertEquals((await startReview(deps(NOW - 1000, done), "12", expected)).kind, "started");
  assertEquals(done[2], `export 12 ${expected}`);
});

Deno.test("a head other than the expected one is refused, the session left locked and said so", async () => {
  const done: string[] = [];
  const mismatch = () => Promise.reject(new UnexpectedHead("the fetched head is a, not b"));
  const outcome = await startReview(
    { ...deps(NOW - 1000, done), exportBranch: mismatch },
    "12",
    "b",
  );
  assertEquals(outcome, {
    kind: "refused",
    why: `the fetched head is a, not b; ${LOCKED_AFTER_MISMATCH}`,
  });
  assertEquals(done, ["taken", "lock s-1"], "locked, and nothing recorded or kept");
});

Deno.test("an export the lock could not record is not kept", async () => {
  const done: string[] = [];
  const failing = { ...deps(NOW - 1000, done), record: () => Promise.reject(new Error("EROFS")) };
  await assertRejects(() => startReview(failing, "12"), Error, "EROFS");
  assertEquals(done, ["taken", "lock s-1", "export 12"]);
});

Deno.test("the session the pass names is locked before anything of the branch is fetched", async () => {
  const done: string[] = [];
  const failing = { ...deps(NOW - 1000, done), lock: () => Promise.reject(new Error("EACCES")) };
  await assertRejects(() => startReview(failing, "12"), Error, "EACCES");
  assertEquals(done, ["taken"], "a lock that cannot be written fetches nothing");
});

Deno.test("a pass that names no session id starts nothing, locks nothing and fetches nothing", async () => {
  for (const session of ["", "../s", "s 1"]) {
    const done: string[] = [];
    const outcome = await startReview(deps(NOW - 1000, done, TIP, JUDGED, JUDGED, session), "12");
    assertEquals(outcome, { kind: "refused", why: NO_SESSION }, session);
    assertEquals(done, ["taken"]);
  }
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

Deno.test("a start that carries no nonce, as one run outside the hook, takes no pass", async () => {
  for (const nonce of [null, "", "not a nonce"]) {
    const done: string[] = [];
    const outcome = await startReview({ ...deps(NOW - 1000, done), nonce }, "12");
    assertEquals(outcome, { kind: "refused", why: NOT_THIS_COMMAND }, String(nonce));
    assertEquals(done, ["taken"], "nothing is locked or fetched");
  }
});

Deno.test("a start carrying the nonce another line was passed with takes no pass", async () => {
  const done: string[] = [];
  const other = { ...deps(NOW - 1000, done), nonce: "f".repeat(32) };
  assertEquals(await startReview(other, "12"), { kind: "refused", why: NOT_THIS_COMMAND });
  assertEquals(done, ["taken"]);
});
