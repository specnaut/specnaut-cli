import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { FsReviewLock } from "../../src/infrastructure/fs_review_lock.ts";

/** What `review start` records beyond the head and logs: the base tip and the toolchain. */

const SHA = "a".repeat(40);

async function inRepository(fn: (dir: string, lock: FsReviewLock) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "review-lock-" });
  try {
    await new Deno.Command("git", { args: ["init", "-q", dir] }).output();
    await fn(dir, await FsReviewLock.open(dir, { state: join(dir, "state", "review-lock") }));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("the entry records the base tip the start was judged against; a malformed one names none", async () => {
  await inRepository(async (dir, lock) => {
    const base = "b".repeat(40);
    await lock.lock("s-1");
    await lock.record("s-1", { head: SHA, logs: "/c/logs", base });
    assertEquals(await lock.held("s-1"), { head: SHA, logs: "/c/logs", base });
    await Deno.remove(join(dir, "state", "review-lock", "s-1.json"));
    const file = join(dir, ".git", "specnaut", "review-lock", "s-1.json");
    await Deno.writeTextFile(file, JSON.stringify({ head: SHA, logs: "/c/logs", base: "main" }));
    assertEquals(await lock.held("s-1"), { head: SHA, logs: "/c/logs", base: null });
  });
});

Deno.test("the entry records the toolchain folders; a list holding anything but a folder names none", async () => {
  await inRepository(async (dir, lock) => {
    const toolchain = ["/opt/go/bin", "/home/u/.deno/bin"];
    await lock.lock("s-1");
    await lock.record("s-1", { head: SHA, logs: "/c/logs", toolchain });
    assertEquals(await lock.held("s-1"), { head: SHA, logs: "/c/logs", toolchain });
    await Deno.remove(join(dir, "state", "review-lock", "s-1.json"));
    const file = join(dir, ".git", "specnaut", "review-lock", "s-1.json");
    for (const bad of [["/opt", "relative"], ["/opt/a:/opt/b"], "/opt", [7]]) {
      await Deno.writeTextFile(
        file,
        JSON.stringify({ head: SHA, logs: "/c/logs", toolchain: bad }),
      );
      assertEquals(await lock.held("s-1"), { head: SHA, logs: "/c/logs", toolchain: [] }, `${bad}`);
    }
  });
});
