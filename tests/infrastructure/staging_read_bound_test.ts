import { assertEquals, assertIsError, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { PathRefusal } from "../../src/application/path_refusal.ts";
import { ReconcilePathUseCase } from "../../src/application/reconcile_path.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";
import { DenoFsWriter } from "../../src/infrastructure/deno_fs_writer.ts";
import { DenoFsReader } from "../../src/infrastructure/fs_reader.ts";
import { FsLockStore } from "../../src/infrastructure/fs_lock_store.ts";
import { FsStagingStore } from "../../src/infrastructure/fs_staging_store.ts";
import { makeLink, symlinkTest } from "../helpers/link_text.ts";

/**
 * cli#765: a staging read is bound to the staged entry, as a delete is (cli#751).
 * `read` followed every link inside the staging folder, so reconcile took a
 * link's target for the upstream copy, wrote the project file and the lock, and
 * only then did `delete` refuse — a run stopped half-applied. Both layouts below
 * stay inside the project, so the project bound alone admits them.
 */

const REL = "a/b/tool";
const LOCAL = "LOCAL\n";

type Layout = { proj: string; staging: string };

async function withProject(fn: (l: Layout) => Promise<void>): Promise<void> {
  const proj = await Deno.makeTempDir({ prefix: "staging-read-bound-" });
  const staging = join(proj, ".specnaut/upgrade-staging");
  try {
    await Deno.mkdir(staging, { recursive: true });
    await Deno.mkdir(join(proj, "src/b"), { recursive: true });
    await Deno.writeTextFile(join(proj, "src/b/tool"), "user file\n");
    await Deno.mkdir(join(proj, "a/b"), { recursive: true });
    await Deno.writeTextFile(join(proj, REL), LOCAL);
    await new FsLockStore().write(proj, lockOf(REL));
    await fn({ proj, staging });
  } finally {
    await Deno.remove(proj, { recursive: true });
  }
}

/** Runs reconcile through the adapters its handler wires, and asserts it wrote nothing. */
async function assertRefusedUnwritten(proj: string): Promise<void> {
  const lockPath = new FsLockStore().lockPath(proj);
  const lockBefore = await Deno.readTextFile(lockPath);
  const run = new ReconcilePathUseCase({
    reader: new DenoFsReader(),
    writer: new DenoFsWriter(),
    lockStore: new FsLockStore(),
    stagingStore: new FsStagingStore(),
  }).execute({ projectDir: proj, path: REL, mode: "accept-upstream" });
  const err = await run.then(() => null, (e: unknown) => e);
  // The disk first: a refusal from `delete` has the same type, and only what was
  // written tells a run refused up front from one stopped half-applied.
  assertEquals(await Deno.readTextFile(join(proj, REL)), LOCAL, "the project file was written");
  assertEquals(await Deno.readTextFile(lockPath), lockBefore, "the lock was written");
  await assertRejects(() => Deno.lstat(join(proj, `${REL}.specnaut.bak`)), Deno.errors.NotFound);
  assertEquals(await Deno.readTextFile(join(proj, "src/b/tool")), "user file\n");
  assertIsError(err, PathRefusal, "refusing to read a staged path");
}

symlinkTest(
  "reconcile refuses a staged entry that is a link, before it writes",
  () =>
    withProject(async ({ proj, staging }) => {
      await Deno.mkdir(join(staging, "a/b"), { recursive: true });
      await makeLink(join(proj, "src/b/tool"), join(staging, REL));
      await assertRefusedUnwritten(proj);
    }),
);

symlinkTest(
  "reconcile refuses a staged entry under a linked staging subfolder, before it writes",
  () =>
    withProject(async ({ proj, staging }) => {
      await makeLink(join(proj, "src"), join(staging, "a"), "dir");
      await assertRefusedUnwritten(proj);
    }),
);

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
