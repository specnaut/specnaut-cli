import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { execLockRefusal } from "../../src/application/review_guard.ts";
import type { ReviewLock } from "../../src/application/review_ports.ts";
import type { LockedReview } from "../../src/domain/review_lock.ts";
import { FsReviewLock } from "../../src/infrastructure/fs_review_lock.ts";
import { hostPath } from "../helpers/host_path.ts";

/**
 * `sandbox exec`'s own lock check, where the session that starts it is known: it reads that
 * session's entry, per-user copy included, and accepts a log only in that session's own folder.
 * Folders and logs are resolved paths, so spelt as the host spells one (`hostPath`).
 */

const SHA = "a".repeat(40);
const MINE: LockedReview = { head: SHA, logs: hostPath("/real/mine") };
const THEIRS: LockedReview = { head: SHA, logs: hostPath("/real/theirs") };

/** A checkout locked by `checkout` (every session's entry), the session `s-1` holding `own`. */
function lock(checkout: readonly LockedReview[], own: LockedReview | null): ReviewLock {
  return {
    lock: () => Promise.reject(new Error("exec never locks")),
    record: () => Promise.reject(new Error("exec never records")),
    held: (id) => Promise.resolve(id === "s-1" ? own : null),
    all: () => Promise.resolve(checkout),
  };
}

const run = (log: string | null) => ({ toolchain: [], log });

Deno.test("a known session's run logs only in its own review's folder", async () => {
  const both = lock([MINE, THEIRS], MINE);
  assertEquals(await execLockRefusal(both, run(hostPath("/real/mine/1.log")), "s-1"), null);
  const theirs = await execLockRefusal(both, run(hostPath("/real/theirs/1.log")), "s-1");
  assertStringIncludes(theirs ?? "ran", "review lock", "another session's folder");
  const unknown = await execLockRefusal(both, run(hostPath("/real/theirs/1.log")), null);
  assertEquals(unknown, null, "an unknown session is judged against every lock of the checkout");
});

Deno.test("a known session's per-user copy locks its runs with no checkout entry", async () => {
  const copyOnly = lock([], MINE);
  const why = await execLockRefusal(copyOnly, run(hostPath("/elsewhere/1.log")), "s-1");
  assertStringIncludes(why ?? "ran", "review lock");
  assertEquals(await execLockRefusal(copyOnly, run(hostPath("/real/mine/1.log")), "s-1"), null);
});

Deno.test("a known session not itself locked runs nothing while its checkout is", async () => {
  const why = await execLockRefusal(
    lock([THEIRS], null),
    run(hostPath("/real/theirs/1.log")),
    "s-2",
  );
  assertStringIncludes(why ?? "ran", "review lock");
  assertEquals(await execLockRefusal(lock([], null), run(null), "s-2"), null, "no lock at all");
  const notAnId = await execLockRefusal(
    lock([THEIRS], null),
    run(hostPath("/real/theirs/1.log")),
    "../x",
  );
  assertEquals(notAnId, null, "a value that is no id names no session");
});

async function inRepository(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "review-guard-exec-" });
  try {
    await new Deno.Command("git", { args: ["init", "-q", dir] }).output();
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("the files' lock refuses a run its checkout entry no longer shows", async () => {
  await inRepository(async (dir) => {
    const state = join(dir, "state", "review-lock");
    const files = await FsReviewLock.open(dir, { state });
    await files.lock("s-1");
    await files.record("s-1", { head: SHA, logs: join(dir, "logs") });
    await Deno.remove(join(dir, ".git", "specnaut", "review-lock", "s-1.json"));
    const why = await execLockRefusal(files, run(join(dir, "x.log")), "s-1");
    assertStringIncludes(why ?? "ran", "review lock");
    assertEquals(await execLockRefusal(files, run(join(dir, "logs", "1.log")), "s-1"), null);
    const outside = await FsReviewLock.open(join(dir, ".."), { state });
    await assertRejects(() => execLockRefusal(outside, run(join(dir, "x.log")), "s-1"));
  });
});
