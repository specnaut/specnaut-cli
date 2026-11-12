import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { FsReviewLock } from "../../src/infrastructure/fs_review_lock.ts";

async function inRepository(fn: (dir: string, lock: FsReviewLock) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "review-lock-" });
  try {
    await new Deno.Command("git", { args: ["init", "-q", dir] }).output();
    await fn(dir, (await FsReviewLock.open(dir))!);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("a locked session stays locked; another session in the checkout is not", async () => {
  await inRepository(async (dir, lock) => {
    assertEquals(await lock.holds("s-1"), false);
    assertEquals(await lock.holds(null), false, "no session is locked yet");
    await lock.lock("s-1");
    await lock.lock("s-1");
    assertEquals(await lock.holds("s-1"), true);
    assertEquals(await lock.holds("s-2"), false);
    assertEquals(await lock.holds(null), true, "with no id, any lock holds");
    const file = join(dir, ".git", "specnaut", "review-lock", "s-1.json");
    assertEquals((await Deno.lstat(file)).isFile, true);
  });
});

Deno.test("a lock is the entry's being there: a file emptied, or replaced by a folder, still holds", async () => {
  await inRepository(async (dir, lock) => {
    await lock.lock("s-1");
    const file = join(dir, ".git", "specnaut", "review-lock", "s-1.json");
    await Deno.writeTextFile(file, "");
    assertEquals(await lock.holds("s-1"), true);
    await Deno.remove(file);
    await Deno.mkdir(file);
    assertEquals(await lock.holds("s-1"), true);
  });
});

Deno.test("anything but a folder where the locks live holds every session: the guard fails closed", async () => {
  await inRepository(async (dir, lock) => {
    await Deno.mkdir(join(dir, ".git", "specnaut"));
    await Deno.writeTextFile(join(dir, ".git", "specnaut", "review-lock"), "");
    assertEquals(await lock.holds("s-9"), true);
    assertEquals(await lock.holds(null), true);
  });
});

Deno.test("only a session id is locked, and outside a repository there is no lock to open", async () => {
  await inRepository(async (_dir, lock) => {
    for (const id of ["", "../s", "s/1", ".s"]) {
      await assertRejects(() => lock.lock(id), Error, "not a session id");
    }
    assertEquals(await lock.holds(null), false);
  });
  const bare = await Deno.makeTempDir({ prefix: "review-lock-none-" });
  try {
    assertEquals(await FsReviewLock.open(bare), null);
  } finally {
    await Deno.remove(bare, { recursive: true });
  }
});
