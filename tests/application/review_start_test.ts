import { assertEquals } from "@std/assert";
import {
  MOVED_PASS,
  NO_PASS,
  STALE_PASS,
  startReview,
} from "../../src/application/review_start.ts";
import type { BranchExport } from "../../src/application/untrusted_review.ts";
import { PASS_TTL_MS } from "../../src/domain/review_gate.ts";

const NOW = 5_000_000;
const TIP = "c".repeat(40);

/**
 * A start whose pass was granted at `granted` (`null`: none) for the base tip `TIP`, while the
 * base's tip is now `tip`; what it did, in `done`.
 */
function deps(granted: number | null, done: string[], tip: string | null = TIP) {
  const exported = { sha: "a".repeat(40), keep: () => void done.push("kept") } as BranchExport;
  return {
    pass: {
      take: () =>
        Promise.resolve(void done.push("taken"))
          .then(() => granted === null ? null : { granted, baseTip: TIP }),
      grant: () => Promise.reject(new Error("unreached")),
      revoke: () => Promise.reject(new Error("unreached")),
    },
    now: () => NOW,
    baseTip: () => Promise.resolve(tip),
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
