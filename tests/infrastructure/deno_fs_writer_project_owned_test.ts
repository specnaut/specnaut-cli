import { assertEquals } from "@std/assert";
import { exists } from "@std/fs/exists";
import { join } from "@std/path";
import { DenoFsWriter } from "../../src/infrastructure/deno_fs_writer.ts";
import type { Bundle } from "../../src/domain/template.ts";

/**
 * A `projectOwned` file is written only where nothing is (spec 038, FR-004):
 * `overwrite` — init `--force`, every upgrade write — does not reach it, where
 * it does reach a plain `skipIfExists` placeholder.
 */

const DEST = "docs/constitution.md";

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-owned-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const bundle = (projectOwned: boolean): Bundle => ({
  [DEST]: {
    content: "bootstrap\n",
    executable: false,
    skipIfExists: true,
    ...(projectOwned ? { projectOwned: true as const } : {}),
  },
});

for (const backupExisting of [false, true]) {
  Deno.test(`a projectOwned file survives overwrite (backup: ${backupExisting})`, async () => {
    await withTempDir(async (dir) => {
      await Deno.mkdir(join(dir, "docs"));
      await Deno.writeTextFile(join(dir, DEST), "ours\r\n");
      const report = await new DenoFsWriter().writeBundle(bundle(true), dir, {
        overwrite: true,
        backupExisting,
      });
      assertEquals(await Deno.readTextFile(join(dir, DEST)), "ours\r\n");
      assertEquals(report.skippedSkipIfExists, [DEST]);
      assertEquals(report.backups, []);
      assertEquals(await exists(join(dir, `${DEST}.specnaut.bak`)), false);
    });
  });
}

Deno.test("a projectOwned file is written where nothing is", async () => {
  await withTempDir(async (dir) => {
    await new DenoFsWriter().writeBundle(bundle(true), dir, { overwrite: true });
    assertEquals(await Deno.readTextFile(join(dir, DEST)), "bootstrap\n");
  });
});

Deno.test("a plain skipIfExists placeholder is still rewritten under overwrite", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, "docs"));
    await Deno.writeTextFile(join(dir, DEST), "ours\n");
    await new DenoFsWriter().writeBundle(bundle(false), dir, { overwrite: true });
    assertEquals(await Deno.readTextFile(join(dir, DEST)), "bootstrap\n");
  });
});
