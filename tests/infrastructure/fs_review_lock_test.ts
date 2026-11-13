import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { UNKNOWN_REVIEW } from "../../src/domain/review_lock.ts";
import {
  FsReviewLock,
  realLogPath,
  reviewLockStateFolder,
} from "../../src/infrastructure/fs_review_lock.ts";

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

Deno.test("a lock is the entry's being there: a file emptied, or replaced by a folder, still holds", async () => {
  await inRepository(async (dir, lock) => {
    await lock.lock("s-1");
    await lock.record("s-1", { head: SHA, logs: "/c/logs" });
    // The git directory's entry alone: the per-user copy, read first, is the same file format.
    await Deno.remove(join(dir, "state", "review-lock", "s-1.json"));
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

Deno.test("only a session id is locked, and outside a repository nothing can be locked", async () => {
  await inRepository(async (_dir, lock) => {
    for (const id of ["", "../s", "s/1", ".s"]) {
      await assertRejects(() => lock.lock(id), Error, "not a session id");
    }
    assertEquals(await lock.held(null), null);
  });
  const bare = await Deno.makeTempDir({ prefix: "review-lock-none-" });
  try {
    const lock = await FsReviewLock.open(bare, { state: join(bare, "state") });
    await assertRejects(() => lock.lock("s-1"), Error, "no git repository");
    assertEquals(await lock.held("s-1"), null);
    assertEquals(await lock.all(), []);
  } finally {
    await Deno.remove(bare, { recursive: true });
  }
});

Deno.test("the lock has a per-user copy, and a session it holds is refused where git finds no repository", async () => {
  await inRepository(async (dir, lock) => {
    const state = join(dir, "state", "review-lock");
    await lock.lock("s-1");
    await lock.record("s-1", { head: SHA, logs: "/c/logs" });
    const copy = JSON.parse(await Deno.readTextFile(join(state, "s-1.json")));
    assertEquals([copy.session, copy.head, copy.logs], ["s-1", SHA, "/c/logs"]);
    await Deno.remove(join(dir, ".git", "specnaut"), { recursive: true });
    assertEquals(await lock.held("s-1"), { head: SHA, logs: "/c/logs" }, "the copy still locks");
    const bare = await Deno.makeTempDir({ prefix: "review-lock-none-" });
    try {
      const outside = await FsReviewLock.open(bare, { state });
      await assertRejects(() => outside.held("s-1"), Error, "cannot find this checkout's git");
      assertEquals(await outside.held("s-2"), null, "another session runs as before");
      assertEquals(await outside.held(null), null);
      const none = await FsReviewLock.open(dir, { state: null });
      await assertRejects(() => none.lock("s-3"), Error, "XDG_STATE_HOME or HOME");
    } finally {
      await Deno.remove(bare, { recursive: true });
    }
    await Deno.remove(state, { recursive: true });
    await Deno.writeTextFile(state, "");
    assertEquals(await lock.held("s-9"), UNKNOWN_REVIEW, "a copy folder that is no folder holds");
  });
});

Deno.test("the per-user folder is XDG_STATE_HOME's, else the home's .local/state", () => {
  const env = (vars: Record<string, string>) => (name: string) => vars[name];
  const tail = join("specnaut", "review-lock");
  assertEquals(reviewLockStateFolder(env({ XDG_STATE_HOME: "/x", HOME: "/h" })), join("/x", tail));
  assertEquals(
    reviewLockStateFolder(env({ XDG_STATE_HOME: "rel", HOME: "/h" })),
    join("/h", ".local", "state", tail),
  );
  assertEquals(
    reviewLockStateFolder(env({ USERPROFILE: "/u" })),
    join("/u", ".local", "state", tail),
  );
  assertEquals(reviewLockStateFolder(env({ HOME: "rel" })), null);
  assertEquals(reviewLockStateFolder(env({})), null);
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
