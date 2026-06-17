import { assertEquals } from "@std/assert";
import { FsPreserveStore } from "../../src/infrastructure/fs_preserve_store.ts";
import { EMPTY_PRESERVE_CONFIG } from "../../src/domain/preserve_config.ts";

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-preserve-store-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("FsPreserveStore.read returns EMPTY_PRESERVE_CONFIG when the manifest is absent", async () => {
  await withTempDir(async (dir) => {
    const store = new FsPreserveStore();
    assertEquals(await store.read(dir), EMPTY_PRESERVE_CONFIG);
  });
});

Deno.test("FsPreserveStore write-then-read round-trips", async () => {
  await withTempDir(async (dir) => {
    const store = new FsPreserveStore();
    await store.write(dir, {
      preserved: [".claude/agents/product-owner.md", ".claude/agents/developer.md"],
    });
    const cfg = await store.read(dir);
    assertEquals(cfg.preserved, [
      ".claude/agents/product-owner.md",
      ".claude/agents/developer.md",
    ]);
  });
});

Deno.test("FsPreserveStore.read degrades a malformed manifest to empty (no throw)", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(`${dir}/.specnaut`, { recursive: true });
    await Deno.writeTextFile(`${dir}/.specnaut/preserve.yml`, "preserved:\n  - [unterminated\n");
    const store = new FsPreserveStore();
    assertEquals(await store.read(dir), EMPTY_PRESERVE_CONFIG);
  });
});

Deno.test("FsPreserveStore.write creates the .specnaut directory if missing", async () => {
  await withTempDir(async (dir) => {
    const store = new FsPreserveStore();
    await store.write(dir, { preserved: ["a.md"] });
    const raw = await Deno.readTextFile(`${dir}/.specnaut/preserve.yml`);
    assertEquals(raw.includes("a.md"), true);
  });
});
