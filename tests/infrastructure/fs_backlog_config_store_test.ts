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

Deno.test("writeStubIfAbsent writes the stub when no config exists", async () => {
  await withTempDir(async (dir) => {
    assertEquals(
      await new FsBacklogConfigStore().writeStubIfAbsent(dir, "backend: github\n"),
      true,
    );
    assertEquals(
      await Deno.readTextFile(join(dir, ".specnaut", "backlog-config.yml")),
      "backend: github\n",
    );
  });
});

Deno.test("writeStubIfAbsent never clobbers an existing config", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, ".specnaut", "backlog-config.yml");
    await Deno.mkdir(join(dir, ".specnaut"));
    await Deno.writeTextFile(path, "backend: gitlab # the user's own\n");
    assertEquals(
      await new FsBacklogConfigStore().writeStubIfAbsent(dir, "backend: github\n"),
      false,
    );
    assertEquals(await Deno.readTextFile(path), "backend: gitlab # the user's own\n");
  });
});

Deno.test({
  name: "writeStubIfAbsent: an existence check that fails for any reason but absence throws",
  // The probe below plants a symlink, which Windows refuses without Developer
  // Mode; the rule itself is platform-neutral.
  ignore: Deno.build.os === "windows",
  fn: async () => {
    // A config that links to itself: `stat` fails with FilesystemLoop. Taken as
    // "absent", the stub went on to the write, where the containment guard
    // refused it as a cycle — the right outcome for the wrong reason, and the
    // probe's own error never reached the caller.
    await withTempDir(async (dir) => {
      const path = join(dir, ".specnaut", "backlog-config.yml");
      await Deno.mkdir(join(dir, ".specnaut"));
      await Deno.symlink(path, path);
      await assertRejects(
        () => new FsBacklogConfigStore().writeStubIfAbsent(dir, "backend: github\n"),
        Deno.errors.FilesystemLoop,
      );
    });
  },
});
