import { assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { FsUpgradeMarkerStore } from "../../src/infrastructure/fs_upgrade_marker_store.ts";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "specflow-marker-test-" });
  try {
    return await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("FsUpgradeMarkerStore: read returns null when absent", async () => {
  await withTempDir(async (dir) => {
    const store = new FsUpgradeMarkerStore();
    assertEquals(await store.read(dir), null);
  });
});

Deno.test("FsUpgradeMarkerStore: write then read round-trips", async () => {
  await withTempDir(async (dir) => {
    const store = new FsUpgradeMarkerStore();
    const marker = { from: "1.4.0", to: "1.5.0", at: "2026-05-16T00:00:00.000Z" };
    await store.write(dir, marker);
    assertEquals(await store.read(dir), marker);
  });
});

Deno.test("FsUpgradeMarkerStore: delete removes file", async () => {
  await withTempDir(async (dir) => {
    const store = new FsUpgradeMarkerStore();
    await store.write(dir, { from: "1.4.0", to: "1.5.0", at: "2026-05-16T00:00:00.000Z" });
    await store.delete(dir);
    assertEquals(await store.read(dir), null);
  });
});

Deno.test("FsUpgradeMarkerStore: delete is idempotent (no-op when absent)", async () => {
  await withTempDir(async (dir) => {
    const store = new FsUpgradeMarkerStore();
    // Should not throw.
    await store.delete(dir);
  });
});

Deno.test("FsUpgradeMarkerStore: read treats corrupt JSON as absent", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(resolve(dir, ".specflow"), { recursive: true });
    await Deno.writeTextFile(
      resolve(dir, ".specflow/upgrade-pending.json"),
      "{this is not valid json",
    );
    const store = new FsUpgradeMarkerStore();
    assertEquals(await store.read(dir), null);
  });
});

Deno.test("FsUpgradeMarkerStore: read treats missing fields as absent", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(resolve(dir, ".specflow"), { recursive: true });
    await Deno.writeTextFile(
      resolve(dir, ".specflow/upgrade-pending.json"),
      JSON.stringify({ from: "1.0.0" }),
    );
    const store = new FsUpgradeMarkerStore();
    assertEquals(await store.read(dir), null);
  });
});
