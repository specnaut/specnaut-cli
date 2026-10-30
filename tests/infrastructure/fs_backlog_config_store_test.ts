import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { FsBacklogConfigStore } from "../../src/infrastructure/fs_backlog_config_store.ts";

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-backlog-config-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("readCloudConfig: an absent file is not Cloud-linked", async () => {
  await withTempDir(async (dir) => {
    assertEquals(await new FsBacklogConfigStore().readCloudConfig(dir), null);
  });
});

Deno.test("writeCloudConfig → readCloudConfig round-trips api_url + project_key", async () => {
  await withTempDir(async (dir) => {
    const store = new FsBacklogConfigStore();
    await store.writeCloudConfig(dir, "https://api.example.com", "CLOUD");
    assertEquals(await store.readCloudConfig(dir), {
      apiUrl: "https://api.example.com",
      projectKey: "CLOUD",
    });
  });
});

Deno.test("readCloudConfig: a read that fails for any reason but absence throws", async () => {
  // A directory where the file should be: present, and unreadable. Reading it
  // as "not linked" would hide the fault behind the unlinked-project message.
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, ".specnaut", "backlog-config.yml"), { recursive: true });
    await assertRejects(() => new FsBacklogConfigStore().readCloudConfig(dir));
  });
});
