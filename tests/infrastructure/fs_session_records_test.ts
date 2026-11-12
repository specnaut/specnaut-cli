import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { RECORD_RETENTION_MS } from "../../src/domain/session_record.ts";
import { FsSessionRecords } from "../../src/infrastructure/fs_session_records.ts";
import { git } from "../integration/verify_scripts_fixture.ts";

/**
 * The record folder as the writer keeps it: a write removes the records other sessions left past
 * the retention, never the writing session's own, and a failed write reports why it failed.
 */

async function records(): Promise<FsSessionRecords> {
  const root = await Deno.realPath(await Deno.makeTempDir({ prefix: "session-records-" }));
  await git(root, "init", "-q", "-b", "main");
  return (await FsSessionRecords.open(root))!;
}

const exists = (path: string) => Deno.lstat(path).then(() => true, () => false);

/** `path` last written past the retention, by a day. */
async function aged(path: string): Promise<void> {
  const old = new Date(Date.now() - RECORD_RETENTION_MS - 24 * 3600 * 1000);
  await Deno.utime(path, old, old);
}

Deno.test("a write removes another session's record past the retention, and keeps a recent one", async () => {
  const store = await records();
  const old = (await store.write("old-session", "{}\n")).path;
  const recent = (await store.write("recent-session", "{}\n")).path;
  await aged(old);
  const leftover = join(store.dir, ".old-session.3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f.tmp");
  await Deno.writeTextFile(leftover, "{}\n");
  await aged(leftover);
  await store.write("new-session", "{}\n");
  assertEquals(await exists(old), false, "past the retention");
  assertEquals(await exists(leftover), false, "a temp file a failed write left");
  assert(await exists(recent), "within the retention");
});

Deno.test("a write never removes its own session's record, however old", async () => {
  const store = await records();
  const own = (await store.write("own-session", "{}\n")).path;
  await aged(own);
  assertEquals((await store.write("own-session", "{}\n")).kind, "existing");
  assert(await exists(own));
});

Deno.test("a link that fails is the error reported, even when removing the temp file fails too", async () => {
  const store = await records();
  const link = Deno.link;
  const remove = Deno.remove;
  const linkFailure = new Deno.errors.PermissionDenied("link refused");
  Deno.link = () => Promise.reject(linkFailure);
  Deno.remove = () => Promise.reject(new Deno.errors.PermissionDenied("remove refused"));
  try {
    const err = await assertRejects(() => store.write("a-session", "{}\n"));
    assertEquals((err as Error).cause, linkFailure);
    assert((err as Error).message.startsWith("link refused"), (err as Error).message);
    assertStringIncludes((err as Error).message, "remove refused");
  } finally {
    Deno.link = link;
    Deno.remove = remove;
  }
});
