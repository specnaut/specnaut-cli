import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { FsLockStore } from "../../src/infrastructure/fs_lock_store.ts";
import { FsPreserveStore } from "../../src/infrastructure/fs_preserve_store.ts";
import { FsUpgradeMarkerStore } from "../../src/infrastructure/fs_upgrade_marker_store.ts";
import { FsStagingStore } from "../../src/infrastructure/fs_staging_store.ts";
import { SpecCacheWriter } from "../../src/infrastructure/spec/spec_cache_writer.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";
import { symlinkTest } from "../helpers/link_text.ts";

/**
 * One refusal assertion per guard CALL SITE.
 *
 * The completeness sweep beside this file checks that a mutating module
 * *mentions* `fs_containment`. That is deliberately coarse — it catches the
 * module nobody guarded at all — and it is not evidence that any particular
 * sink asks. The review made the gap concrete: neutering the guards one at a
 * time, ten of thirteen call sites could be deleted with all 1530 tests still
 * green, including both guards standing in front of the only recursive delete
 * in the codebase.
 *
 * So: a test per site, each one deleted-guard-red. The population here and the
 * population the sweep walks are the same list; when they disagree, one of the
 * two is wrong and that is worth knowing.
 */

/** A project whose `.specnaut/` is a symlink to a directory outside it. */
async function redirected(): Promise<{ root: string; proj: string; outside: string }> {
  const root = await Deno.makeTempDir({ prefix: "sink-" });
  const proj = join(root, "proj");
  const outside = join(root, "outside");
  await Deno.mkdir(proj);
  await Deno.mkdir(outside);
  await Deno.symlink(outside, join(proj, ".specnaut"));
  return { root, proj, outside };
}

async function nothingLandedIn(dir: string): Promise<number> {
  let n = 0;
  for await (const _ of Deno.readDir(dir)) n++;
  return n;
}

const LOCK: InstalledLock = {
  version: 2,
  harness: "claude",
  backlogBackend: "local",
  versionScheme: "semver",
  specBackend: "local",
  templatesVersion: "4.0.1",
  entries: new Map(),
};

symlinkTest("FsLockStore.write refuses a redirected .specnaut", async () => {
  const { root, proj, outside } = await redirected();
  try {
    await assertRejects(() => new FsLockStore().write(proj, LOCK));
    assertEquals(await nothingLandedIn(outside), 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("FsPreserveStore.write refuses a redirected .specnaut", async () => {
  const { root, proj, outside } = await redirected();
  try {
    await assertRejects(() => new FsPreserveStore().write(proj, { preserved: ["x.md"] }));
    assertEquals(await nothingLandedIn(outside), 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("FsUpgradeMarkerStore.write refuses a redirected .specnaut", async () => {
  const { root, proj, outside } = await redirected();
  try {
    await assertRejects(() =>
      new FsUpgradeMarkerStore().write(proj, { from: "1.0.0", to: "2.0.0", at: "2026-01-01" })
    );
    assertEquals(await nothingLandedIn(outside), 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("FsStagingStore.read refuses a redirected .specnaut", async () => {
  const { root, proj, outside } = await redirected();
  try {
    await Deno.mkdir(join(outside, "upgrade-staging"), { recursive: true });
    await Deno.writeTextFile(join(outside, "upgrade-staging/secret.md"), "SECRET");
    await assertRejects(() => new FsStagingStore().read(proj, "secret.md"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("FsStagingStore.delete refuses a redirected .specnaut", async () => {
  const { root, proj, outside } = await redirected();
  try {
    await Deno.mkdir(join(outside, "upgrade-staging"), { recursive: true });
    await Deno.writeTextFile(join(outside, "upgrade-staging/keep.md"), "KEEP");
    await assertRejects(() => new FsStagingStore().delete(proj, "keep.md"));
    assertEquals(await Deno.readTextFile(join(outside, "upgrade-staging/keep.md")), "KEEP");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("SpecCacheWriter.write refuses a redirected .specnaut", async () => {
  const { root, proj, outside } = await redirected();
  try {
    await assertRejects(() =>
      new SpecCacheWriter().write(proj, 7, [
        { order: 1, key: "spec", name: "Spec", body: "x" } as never,
      ])
    );
    assertEquals(await nothingLandedIn(outside), 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest(
  "SpecCacheWriter.clear refuses a redirected .specnaut, and does NOT swallow it",
  async () => {
    // The most valuable one here. `clear` is the only recursive delete in this
    // codebase, and its guard used to sit INSIDE the `try` whose catch swallows
    // `NotFound` to keep the method idempotent — the same error
    // `resolveProjectRoot` raises when the project directory is gone. A refusal
    // that becomes a silent return in front of `Deno.remove(..., recursive)` is
    // worse than no refusal, because the report then says the cache was cleared.
    const { root, proj, outside } = await redirected();
    try {
      await Deno.mkdir(join(outside, "specs/.cache/7"), { recursive: true });
      await Deno.writeTextFile(join(outside, "specs/.cache/7/precious.md"), "PRECIOUS");
      await assertRejects(() => new SpecCacheWriter().clear(proj, 7));
      assertEquals(
        await Deno.readTextFile(join(outside, "specs/.cache/7/precious.md")),
        "PRECIOUS",
        "the recursive delete must not have run",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

symlinkTest("the stores still work on an ordinary project", async () => {
  // The positive control for this whole file. Seven refusals above, and a set
  // of stores that refused unconditionally would satisfy every one of them.
  const root = await Deno.makeTempDir({ prefix: "sink-ok-" });
  try {
    await new FsLockStore().write(root, LOCK);
    await new FsPreserveStore().write(root, { preserved: ["x.md"] });
    await new FsUpgradeMarkerStore().write(root, {
      from: "1.0.0",
      to: "2.0.0",
      at: "2026-01-01",
    });
    assertEquals(
      await Deno.stat(join(root, ".specnaut/installed.lock")).then(() => true).catch(() => false),
      true,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("FsUpgradeMarkerStore.delete refuses a redirected .specnaut", async () => {
  // `write()` guarded and `delete()` did not — one method of a pair, which is
  // the shape a file-level sweep is structurally unable to see. It is why the
  // sweep beside this file now attributes each sink to its own method.
  const { root, proj, outside } = await redirected();
  try {
    await Deno.writeTextFile(join(outside, "upgrade-pending.json"), "{}");
    await assertRejects(() => new FsUpgradeMarkerStore().delete(proj));
    assertEquals(
      await Deno.stat(join(outside, "upgrade-pending.json")).then(() => true).catch(() => false),
      true,
      "the file outside must survive",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

symlinkTest("FsStagingStore.cleanupIfEmpty refuses a redirected .specnaut", async () => {
  // `Deno.readDir` FOLLOWS a symlinked directory and lists the TARGET's
  // entries, so an empty out-of-project directory made this decide "prune it"
  // on evidence gathered somewhere else entirely — and then removed it.
  const { root, proj, outside } = await redirected();
  try {
    await Deno.mkdir(join(outside, "upgrade-staging"));
    await assertRejects(() => new FsStagingStore().cleanupIfEmpty(proj));
    assertEquals(
      await Deno.stat(join(outside, "upgrade-staging")).then(() => true).catch(() => false),
      true,
      "the empty directory outside must survive",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
