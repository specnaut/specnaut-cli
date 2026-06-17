import { assertEquals } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { migrateLegacyConfigDir } from "../../src/infrastructure/fs_legacy_migrator.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-migrate-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("migrate: nothing to migrate when neither dir exists", async () => {
  await withTempDir(async (dir) => {
    const r = await migrateLegacyConfigDir(dir);
    assertEquals(r.kind, "nothing-to-migrate");
  });
});

Deno.test("migrate: renames legacy .specflow/ → .specnaut/ preserving contents", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, ".specflow/memory"), { recursive: true });
    await Deno.writeTextFile(join(dir, ".specflow/installed.lock"), "lock");
    await Deno.writeTextFile(join(dir, ".specflow/memory/constitution.md"), "c");

    const r = await migrateLegacyConfigDir(dir);
    assertEquals(r.kind, "migrated");

    assertEquals(await exists(join(dir, ".specflow")), false);
    assertEquals(await exists(join(dir, ".specnaut/installed.lock")), true);
    assertEquals(
      await Deno.readTextFile(join(dir, ".specnaut/memory/constitution.md")),
      "c",
    );
  });
});

Deno.test("migrate: idempotent no-op when only .specnaut/ exists", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, ".specnaut"), { recursive: true });
    const r = await migrateLegacyConfigDir(dir);
    assertEquals(r.kind, "already-current");
    assertEquals(await exists(join(dir, ".specnaut")), true);
  });
});

Deno.test("migrate: conflict when BOTH dirs exist — neither is touched", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
    await Deno.writeTextFile(join(dir, ".specflow/marker"), "legacy");
    await Deno.mkdir(join(dir, ".specnaut"), { recursive: true });
    await Deno.writeTextFile(join(dir, ".specnaut/marker"), "current");

    const r = await migrateLegacyConfigDir(dir);
    assertEquals(r.kind, "conflict");
    // Both preserved verbatim — no silent merge/overwrite.
    assertEquals(await Deno.readTextFile(join(dir, ".specflow/marker")), "legacy");
    assertEquals(await Deno.readTextFile(join(dir, ".specnaut/marker")), "current");
  });
});
