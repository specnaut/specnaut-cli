import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { FsReviewLock } from "../../src/infrastructure/fs_review_lock.ts";

/**
 * The writer of a lock (`review start`, from the session's shell) and its reader (the hook's
 * guard) agree on the per-user folder: the checkout's entry records the one its copy went to, and
 * a guard reading another refuses rather than judge without the copy.
 */

const SHA = "a".repeat(40);

async function inRepository(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "review-lock-state-" });
  try {
    await new Deno.Command("git", { args: ["init", "-q", dir] }).output();
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const entry = (dir: string) => join(dir, ".git", "specnaut", "review-lock", "s-1.json");

Deno.test("the checkout's entry records the per-user folder its copy went to", async () => {
  await inRepository(async (dir) => {
    const state = join(dir, "state-a", "review-lock");
    const writer = await FsReviewLock.open(dir, { state });
    await writer.lock("s-1");
    assertEquals(JSON.parse(await Deno.readTextFile(entry(dir))).state, state, "at lock");
    await writer.record("s-1", { head: SHA, logs: "/c/logs" });
    assertEquals(JSON.parse(await Deno.readTextFile(entry(dir))).state, state, "at record");
  });
});

Deno.test("a guard reading another per-user folder than the entry's refuses the session", async () => {
  await inRepository(async (dir) => {
    const writer = await FsReviewLock.open(dir, { state: join(dir, "state-a", "review-lock") });
    await writer.lock("s-1");
    await writer.record("s-1", { head: SHA, logs: "/c/logs" });
    const other = await FsReviewLock.open(dir, { state: join(dir, "state-b", "review-lock") });
    await assertRejects(() => other.held("s-1"), Error, join(dir, "state-a", "review-lock"));
    const none = await FsReviewLock.open(dir, { state: null });
    await assertRejects(() => none.held("s-1"), Error, "per-user", "no folder to read");
    assertEquals(await other.held("s-2"), null, "another session is not judged by it");
  });
});

Deno.test("a guard reading the entry's own folder judges it, its copy there or not", async () => {
  await inRepository(async (dir) => {
    const state = join(dir, "state-a", "review-lock");
    const lock = await FsReviewLock.open(dir, { state });
    await lock.lock("s-1");
    await lock.record("s-1", { head: SHA, logs: "/c/logs" });
    await Deno.remove(join(state, "s-1.json"));
    assertEquals(await lock.held("s-1"), { head: SHA, logs: "/c/logs" });
    await Deno.writeTextFile(entry(dir), `{"head":"${SHA}","logs":"/c/logs"}`);
    const other = await FsReviewLock.open(dir, { state: join(dir, "state-b", "review-lock") });
    assertEquals(await other.held("s-1"), { head: SHA, logs: "/c/logs" }, "naming no folder");
  });
});
