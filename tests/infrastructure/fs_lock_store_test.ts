import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { FsLockStore } from "../../src/infrastructure/fs_lock_store.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";

async function withProjectDir(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-lockstore-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const SAMPLE: InstalledLock = {
  version: 2,
  harness: "claude",
  backlogBackend: "local",
  versionScheme: "semver",
  templatesVersion: "0.3.0",
  entries: new Map([
    ["CLAUDE.md", {
      sha256: "aaa",
      installedAt: "2026-04-25T00:00:00Z",
      templatesVersion: "0.3.0",
    }],
  ]),
};

Deno.test("FsLockStore.read returns null when absent", async () => {
  await withProjectDir(async (dir) => {
    const store = new FsLockStore();
    assertEquals(await store.read(dir), null);
  });
});

Deno.test("FsLockStore.write then read round-trips", async () => {
  await withProjectDir(async (dir) => {
    const store = new FsLockStore();
    await store.write(dir, SAMPLE);
    const read = await store.read(dir);
    assertEquals(read?.templatesVersion, "0.3.0");
    assertEquals(read?.entries.get("CLAUDE.md")?.sha256, "aaa");
  });
});

Deno.test("FsLockStore.write creates .specflow dir if absent", async () => {
  await withProjectDir(async (dir) => {
    const store = new FsLockStore();
    await store.write(dir, SAMPLE);
    const stat = await Deno.stat(join(dir, ".specflow/installed.lock"));
    assertEquals(stat.isFile, true);
  });
});

Deno.test("FsLockStore.lockPath returns canonical location", () => {
  const store = new FsLockStore();
  assertEquals(store.lockPath("/proj"), join("/proj", ".specflow/installed.lock"));
});
