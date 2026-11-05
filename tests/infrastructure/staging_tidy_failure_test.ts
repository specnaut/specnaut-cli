import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { ReconcilePathUseCase } from "../../src/application/reconcile_path.ts";
import { pruneStaging } from "../../src/application/upgrade_staging.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";
import { FsStagingStore } from "../../src/infrastructure/fs_staging_store.ts";
import { WINDOWS } from "../helpers/link_text.ts";
import { RUNS_AS_ROOT } from "../helpers/posix_modes.ts";
import {
  fakeLockStore,
  fakeReader,
  fakeStagingStore,
  fakeWriter,
} from "../application/upgrade_fakes.ts";

/**
 * cli#719: once the staged copy is gone, tidying the folder it leaves is
 * best-effort. The walk's failure used to vanish in a silent `catch { break; }`;
 * thrown instead, it would read as a copy that could not be cleared, and
 * `pruneStaging` would call a file already gone "safe to delete by hand". So it
 * comes back as a note naming the folder, and `delete` throws only when the copy
 * is still there.
 *
 * The real store on a real folder: a fake could only prove what the fake does.
 * POSIX only, because a mode is how the folder refuses, and Windows has none; and
 * not as root, who reads and removes through any mode.
 */

const REL = "sub/x.md";

async function withUnlistableParent(
  fn: (dir: string, sub: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "staging-tidy-" });
  const sub = join(dir, ".specnaut/upgrade-staging/sub");
  try {
    await Deno.mkdir(sub, { recursive: true });
    await Deno.writeTextFile(join(sub, "x.md"), "UPSTREAM\n");
    await Deno.chmod(sub, 0o300);
    await fn(dir, sub);
  } finally {
    await Deno.chmod(sub, 0o755);
    await Deno.remove(dir, { recursive: true });
  }
}

/** The staged copy, judged without reading the folder: 0o300 still lets a name resolve. */
const copyIsThere = (sub: string) =>
  Deno.lstat(join(sub, "x.md")).then(() => true, (e) => {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  });

const folderIsThere = (sub: string) => Deno.lstat(sub).then(() => true, () => false);

const POSIX = { ignore: WINDOWS || RUNS_AS_ROOT };

Deno.test(
  "delete: the copy goes, the folder stays, and the note names the folder",
  POSIX,
  () =>
    withUnlistableParent(async (dir, sub) => {
      const notes = await new FsStagingStore().delete(dir, REL);
      assertEquals(await copyIsThere(sub), false, "the staged copy is still there");
      assertEquals(await folderIsThere(sub), true, "the walk removed the folder it could not read");
      assertEquals(notes.length, 1, notes.join("\n"));
      assertStringIncludes(notes[0], "could not remove the emptied folder");
      assertStringIncludes(notes[0], sub);
    }),
);

Deno.test(
  "reconcile: ok, with the note, since the file and the lock are committed",
  POSIX,
  () =>
    withUnlistableParent(async (dir, sub) => {
      const lockStore = fakeLockStore(lockOf(REL));
      const result = await new ReconcilePathUseCase({
        reader: fakeReader({ [REL]: "LOCAL\n" }),
        writer: fakeWriter(),
        lockStore,
        stagingStore: new FsStagingStore(),
      }).execute({ projectDir: dir, path: REL, mode: "accept-upstream" });
      assert(result.status === "ok", result.status);
      assertEquals(lockStore.writes, 1, "the lock was not committed");
      assertEquals(await copyIsThere(sub), false, "the staged copy is still there");
      assertEquals(result.notes.length, 1, result.notes.join("\n"));
      assertStringIncludes(result.notes[0], sub);
    }),
);

Deno.test("reconcile: a staging root that cannot be tidied is a note on an ok too", async () => {
  const lockStore = fakeLockStore(lockOf(REL));
  const result = await new ReconcilePathUseCase({
    reader: fakeReader({ [REL]: "LOCAL\n" }),
    writer: fakeWriter(),
    lockStore,
    stagingStore: {
      list: () => Promise.resolve([REL]),
      read: () => Promise.resolve("UPSTREAM\n"),
      delete: () => Promise.resolve(["a tidy note"]),
      cleanupIfEmpty: () => Promise.reject(new Error("Permission denied")),
    },
  }).execute({ projectDir: "/p", path: REL, mode: "accept-upstream" });
  assert(result.status === "ok", result.status);
  assertEquals(lockStore.writes, 1, "the lock was not committed");
  assertEquals(result.notes[0], "a tidy note");
  assertStringIncludes(result.notes[1], "could not tidy .specnaut/upgrade-staging/");
  assertStringIncludes(result.notes[1], "Permission denied");
  assert(!result.notes[1].includes("safe to delete by hand"), result.notes[1]);
});

Deno.test(
  "pruneStaging: names the folder, not the copy, and never says to delete by hand",
  POSIX,
  async () => {
    // A route `list` can walk: everything is readable, and only the staging root
    // refuses to lose an entry, so the emptied `sub` cannot be removed from it.
    const dir = await Deno.makeTempDir({ prefix: "staging-tidy-" });
    const staging = join(dir, ".specnaut/upgrade-staging");
    const sub = join(staging, "sub");
    try {
      await Deno.mkdir(sub, { recursive: true });
      await Deno.writeTextFile(join(sub, "x.md"), "UPSTREAM\n");
      await Deno.chmod(staging, 0o555);
      const refusals = await pruneStaging(new FsStagingStore(), dir, new Set());
      assertEquals(await copyIsThere(sub), false, "the staged copy is still there");
      assertEquals(
        await folderIsThere(sub),
        true,
        "the folder was removed from a read-only parent",
      );
      assertEquals(refusals.length, 1, refusals.join("\n"));
      assertStringIncludes(refusals[0], "could not remove the emptied folder");
      assertStringIncludes(refusals[0], sub);
      assert(!refusals[0].includes("x.md"), `named the copy: ${refusals[0]}`);
      assert(!refusals[0].includes("safe to delete by hand"), refusals[0]);
    } finally {
      await Deno.chmod(staging, 0o755);
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test("pruneStaging: a staging root that cannot be tidied is said, without the advice", async () => {
  const store = fakeStagingStore();
  store.cleanupIfEmpty = () => Promise.reject(new Error("Permission denied"));
  const refusals = await pruneStaging(store, "/p", new Set());
  assertEquals(refusals.length, 1, refusals.join("\n"));
  assertStringIncludes(refusals[0], "could not tidy .specnaut/upgrade-staging/");
  assertStringIncludes(refusals[0], "Permission denied");
  assert(!refusals[0].includes("safe to delete by hand"), refusals[0]);
});

function lockOf(path: string): InstalledLock {
  return {
    version: 2,
    harness: "claude",
    backlogBackend: "local",
    versionScheme: "semver",
    specBackend: "local",
    templatesVersion: "1.6.0",
    entries: new Map([[path, {
      sha256: "old-sha",
      installedAt: "2026-01-01T00:00:00.000Z",
      templatesVersion: "1.4.0",
    }]]),
  };
}
