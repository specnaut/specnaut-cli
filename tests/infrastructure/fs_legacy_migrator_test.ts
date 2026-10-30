import { assertEquals } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { migrateLegacyConfigDir } from "../../src/infrastructure/fs_legacy_migrator.ts";
import { symlinkTest } from "../helpers/link_text.ts";

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
    await Deno.writeTextFile(join(dir, ".specflow/memory/notes.md"), "c");

    const r = await migrateLegacyConfigDir(dir);
    assertEquals(r.kind, "migrated");

    assertEquals(await exists(join(dir, ".specflow")), false);
    assertEquals(await exists(join(dir, ".specnaut/installed.lock")), true);
    assertEquals(
      await Deno.readTextFile(join(dir, ".specnaut/memory/notes.md")),
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

symlinkTest("a symlinked .specflow is refused, not migrated", async () => {
  // The foothold (cli#574). `isDir` used `Deno.stat`, which follows a link, so
  // a symlink to any directory reported `isDirectory: true`; `Deno.rename`
  // then moved the LINK, and `.specnaut/` became a pointer out of the project.
  // Reproduced end to end before this changed: the migrator returned
  // `migrated` and left an out-of-project config tree that the lock, the
  // marker, the preserve list and the spec cache's RECURSIVE delete all then
  // wrote through.
  //
  // One file in a cloned repository, and it runs first in both `init` and
  // `upgrade`, before anything else.
  const root = await Deno.makeTempDir({ prefix: "legacy-link-" });
  try {
    const proj = `${root}/proj`;
    const outside = `${root}/outside`;
    await Deno.mkdir(proj);
    await Deno.mkdir(outside);
    await Deno.writeTextFile(`${outside}/marker.txt`, "not ours");
    await Deno.symlink(outside, `${proj}/.specflow`);

    const res = await migrateLegacyConfigDir(proj);
    assertEquals(res.kind, "symlinked");

    const after = await Deno.lstat(`${proj}/.specnaut`).catch(() => null);
    assertEquals(after, null, ".specnaut must not exist — nothing was renamed");
    assertEquals(
      (await Deno.lstat(`${proj}/.specflow`)).isSymlink,
      true,
      "and the link is left exactly as the project had it",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("a symlinked .specnaut is refused too", async () => {
  // The other end of the same rule: nothing to migrate, and still a link the
  // rest of the run would write through.
  const root = await Deno.makeTempDir({ prefix: "current-link-" });
  try {
    const proj = `${root}/proj`;
    const outside = `${root}/outside`;
    await Deno.mkdir(proj);
    await Deno.mkdir(outside);
    await Deno.symlink(outside, `${proj}/.specnaut`);
    assertEquals((await migrateLegacyConfigDir(proj)).kind, "symlinked");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("a .specnaut symlink that stays INSIDE the project is not refused", async () => {
  // Over-refusal is a real cost, not a safe default (cli#574 round 2). The
  // first version refused any link at either name, which also refused a project
  // that had linked `.specnaut -> config/specnaut` inside itself — a layout
  // containment allows, and a blanket symlink refusal is named in this
  // feature's decision table as the thing that must not happen.
  //
  // Without this assertion, "refuse every symlink" satisfies the two escape
  // tests above and nobody notices until a user's project stops working.
  const root = await Deno.makeTempDir({ prefix: "inside-link-" });
  try {
    await Deno.mkdir(`${root}/config/specnaut`, { recursive: true });
    await Deno.symlink(`${root}/config/specnaut`, `${root}/.specnaut`);
    assertEquals((await migrateLegacyConfigDir(root)).kind, "already-current");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
