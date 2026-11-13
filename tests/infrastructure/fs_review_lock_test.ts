import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { UNKNOWN_REVIEW } from "../../src/domain/review_lock.ts";
import { FsReviewLock, realLogPath } from "../../src/infrastructure/fs_review_lock.ts";

const SHA = "a".repeat(40);

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
    assertEquals(await lock.held("s-1"), null);
    assertEquals(await lock.held(null), null, "no session is locked yet");
    await lock.lock("s-1");
    await lock.lock("s-1");
    assertEquals(await lock.held("s-1"), UNKNOWN_REVIEW, "locked before anything is exported");
    assertEquals(await lock.held("s-2"), null);
    assertEquals(await lock.held(null), UNKNOWN_REVIEW, "with no id, any lock holds");
    const file = join(dir, ".git", "specnaut", "review-lock", "s-1.json");
    assertEquals((await Deno.lstat(file)).isFile, true);
  });
});

Deno.test("the entry records the review's head and logs folder once the branch is exported", async () => {
  await inRepository(async (_dir, lock) => {
    await lock.lock("s-1");
    await lock.record("s-1", { head: SHA, logs: "/c/logs" });
    assertEquals(await lock.held("s-1"), { head: SHA, logs: "/c/logs" });
    assertEquals(await lock.held(null), UNKNOWN_REVIEW, "an id-less call is told no head");
    await lock.lock("s-2");
    assertEquals(await lock.all(), [{ head: SHA, logs: "/c/logs" }, UNKNOWN_REVIEW]);
    await assertRejects(() => lock.record("../s", { head: SHA, logs: "/c" }), Error, "session id");
  });
});

Deno.test("a lock is the entry's being there: a file emptied, or replaced by a folder, still holds", async () => {
  await inRepository(async (dir, lock) => {
    await lock.lock("s-1");
    await lock.record("s-1", { head: SHA, logs: "/c/logs" });
    const file = join(dir, ".git", "specnaut", "review-lock", "s-1.json");
    for (const text of ["", "[]", `{"head":"HEAD","logs":"relative"}`, "{"]) {
      await Deno.writeTextFile(file, text);
      assertEquals(await lock.held("s-1"), UNKNOWN_REVIEW, text);
    }
    if (Deno.build.os !== "windows") {
      // A link is never read through, whatever it points at.
      const elsewhere = join(dir, "entry.json");
      await Deno.writeTextFile(elsewhere, JSON.stringify({ head: SHA, logs: "/c/logs" }));
      await Deno.remove(file);
      await Deno.symlink(elsewhere, file);
      assertEquals(await lock.held("s-1"), UNKNOWN_REVIEW, "a link");
    }
    await Deno.remove(file);
    await Deno.mkdir(file);
    assertEquals(await lock.held("s-1"), UNKNOWN_REVIEW);
    assertEquals(await lock.all(), [UNKNOWN_REVIEW]);
  });
});

Deno.test("anything but a folder where the locks live holds every session: the guard fails closed", async () => {
  await inRepository(async (dir, lock) => {
    assertEquals(await lock.all(), [], "no lock folder: nothing held");
    await Deno.mkdir(join(dir, ".git", "specnaut"));
    await Deno.writeTextFile(join(dir, ".git", "specnaut", "review-lock"), "");
    assertEquals(await lock.held("s-9"), UNKNOWN_REVIEW);
    assertEquals(await lock.held(null), UNKNOWN_REVIEW);
    assertEquals(await lock.all(), [UNKNOWN_REVIEW]);
  });
});

Deno.test("only a session id is locked, and outside a repository there is no lock to open", async () => {
  await inRepository(async (_dir, lock) => {
    for (const id of ["", "../s", "s/1", ".s"]) {
      await assertRejects(() => lock.lock(id), Error, "not a session id");
    }
    assertEquals(await lock.held(null), null);
  });
  const bare = await Deno.makeTempDir({ prefix: "review-lock-none-" });
  try {
    assertEquals(await FsReviewLock.open(bare), null);
  } finally {
    await Deno.remove(bare, { recursive: true });
  }
});

Deno.test("a log resolves by its folder's real path; a relative, missing or dot name does not", async () => {
  const root = await Deno.realPath(await Deno.makeTempDir({ prefix: "review-log-" }));
  try {
    await Deno.mkdir(join(root, "logs"));
    assertEquals(await realLogPath(join(root, "logs", "1.log")), join(root, "logs", "1.log"));
    for (
      const path of [
        "logs/1.log",
        "1.log",
        join(root, "none", "1.log"),
        `${root}/logs/..`,
        `${root}/logs/.`,
      ]
    ) {
      assertEquals(await realLogPath(path), null, path);
    }
    if (Deno.build.os !== "windows") {
      await Deno.mkdir(join(root, "elsewhere"));
      await Deno.symlink(join(root, "elsewhere"), join(root, "logs", "link"));
      const through = join(root, "logs", "link", "1.log");
      assertEquals(await realLogPath(through), join(root, "elsewhere", "1.log"), "a link followed");
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
