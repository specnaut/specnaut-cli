import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { FsConfigStore } from "../../src/infrastructure/fs_config_store.ts";
import type { SyncConfig } from "../../src/domain/sync_config.ts";

async function withProjectDir(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specflow-config-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const SAMPLE: SyncConfig = {
  version: 1,
  sync: {
    provider: "github",
    repo: "kevinraimbaud/specflow",
    project: {
      number: 3,
      owner: "kevinraimbaud",
      fieldMap: { status: "Status", priority: "Priority", complexity: "Complexity" },
    },
    label_prefix: "backlog/",
  },
};

Deno.test("FsConfigStore.read returns null when config absent", async () => {
  await withProjectDir(async (dir) => {
    const store = new FsConfigStore();
    const cfg = await store.read(dir);
    assertEquals(cfg, null);
  });
});

Deno.test("FsConfigStore.write then read returns the same config", async () => {
  await withProjectDir(async (dir) => {
    const store = new FsConfigStore();
    await store.write(dir, SAMPLE);
    const cfg = await store.read(dir);
    assertEquals(cfg, SAMPLE);
  });
});

Deno.test("FsConfigStore.write creates .specflow dir if absent", async () => {
  await withProjectDir(async (dir) => {
    const store = new FsConfigStore();
    await store.write(dir, SAMPLE);
    const stat = await Deno.stat(join(dir, ".specflow/config.yml"));
    assertEquals(stat.isFile, true);
  });
});

Deno.test("FsConfigStore.configPath returns canonical location", () => {
  const store = new FsConfigStore();
  assertEquals(store.configPath("/proj"), "/proj/.specflow/config.yml");
});
