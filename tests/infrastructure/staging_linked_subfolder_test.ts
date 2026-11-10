import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { PathRefusal } from "../../src/application/path_refusal.ts";
import { ReconcilePathUseCase } from "../../src/application/reconcile_path.ts";
import type { InstalledLock } from "../../src/domain/installed_lock.ts";
import { FsStagingStore } from "../../src/infrastructure/fs_staging_store.ts";
import { makeLink, symlinkTest, WINDOWS } from "../helpers/link_text.ts";
import { fakeLockStore, fakeReader, fakeWriter } from "../application/upgrade_fakes.ts";

/**
 * cli#751: a staging delete judged one file and removed another. Under a linked
 * staging subfolder, `delete` followed every link to judge the path, landed on a
 * project file and admitted it, then unlinked the entry the path names, which
 * lay outside the project; the prune after it removed the outside folder too.
 * A delete now judges the entry it removes, and only inside the real staging
 * folder: anything else is refused, and nothing is unlinked or removed.
 */

const REL = "a/b/tool";

type Layout = { tmp: string; proj: string; staging: string };

async function withLayout(fn: (l: Layout) => Promise<void>): Promise<void> {
  const tmp = await Deno.makeTempDir({ prefix: "staging-linked-sub-" });
  const proj = join(tmp, "proj");
  const staging = join(proj, ".specnaut/upgrade-staging");
  try {
    await Deno.mkdir(staging, { recursive: true });
    await Deno.mkdir(join(proj, "src"));
    await Deno.writeTextFile(join(proj, "src/tool.ts"), "keep\n");
    await fn({ tmp, proj, staging });
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
}

/** The issue's layout: `a` leads outside, and `b/tool` out there leads back to a project file. */
async function issueLayout({ tmp, proj, staging }: Layout): Promise<void> {
  await Deno.mkdir(join(tmp, "outside/dir/b"), { recursive: true });
  await makeLink(join(proj, "src/tool.ts"), join(tmp, "outside/dir/b/tool"));
  await makeLink(join(tmp, "outside/dir"), join(staging, "a"), "dir");
}

const isLink = async (p: string) => (await Deno.lstat(p)).isSymlink;
const there = (p: string) => Deno.lstat(p).then(() => true, () => false);

async function assertIssueLayoutIntact({ tmp, proj, staging }: Layout): Promise<void> {
  assert(await isLink(join(tmp, "outside/dir/b/tool")), "the outside link was unlinked");
  assert(await there(join(tmp, "outside/dir/b")), "the outside folder was removed");
  assert(await isLink(join(staging, "a")), "the staging link was removed");
  assertEquals(await Deno.readTextFile(join(proj, "src/tool.ts")), "keep\n");
}

symlinkTest(
  "delete refuses a path behind a staging link that leads out",
  () =>
    withLayout(async (l) => {
      await issueLayout(l);
      await assertRejects(
        () => new FsStagingStore().delete(l.proj, REL),
        PathRefusal,
        "leaves the project",
      );
      await assertIssueLayoutIntact(l);
    }),
);

symlinkTest(
  "delete refuses a staging link that leads elsewhere in the project",
  () =>
    withLayout(async ({ proj, staging }) => {
      await Deno.mkdir(join(proj, "src/b"));
      await Deno.writeTextFile(join(proj, "src/b/tool"), "user file\n");
      await makeLink(join(proj, "src"), join(staging, "a"), "dir");
      await assertRejects(
        () => new FsStagingStore().delete(proj, REL),
        PathRefusal,
        "refusing to delete a staged path",
      );
      assertEquals(await Deno.readTextFile(join(proj, "src/b/tool")), "user file\n");
    }),
);

symlinkTest(
  "delete refuses a staging link to a sibling whose name only starts alike",
  () =>
    withLayout(async ({ proj, staging }) => {
      const old = join(proj, ".specnaut/upgrade-staging-old");
      await Deno.mkdir(join(old, "b"), { recursive: true });
      await Deno.writeTextFile(join(old, "b/tool"), "not staged\n");
      await makeLink(old, join(staging, "a"), "dir");
      await assertRejects(
        () => new FsStagingStore().delete(proj, REL),
        PathRefusal,
        "refusing to delete a staged path",
      );
      assertEquals(await Deno.readTextFile(join(old, "b/tool")), "not staged\n");
    }),
);

symlinkTest(
  "reconcile gets the store's refusal, and nothing outside is touched",
  () =>
    withLayout(async (l) => {
      await issueLayout(l);
      const run = new ReconcilePathUseCase({
        reader: fakeReader({ [REL]: "LOCAL\n" }),
        writer: fakeWriter(),
        lockStore: fakeLockStore(lockOf(REL)),
        stagingStore: new FsStagingStore(),
      }).execute({ projectDir: l.proj, path: REL, mode: "accept-upstream" });
      await assertRejects(() => run, PathRefusal, "leaves the project");
      await assertIssueLayoutIntact(l);
    }),
);

Deno.test({
  // The bound on Windows, where `symlinkTest` does not run: a junction is the
  // folder link any user can make there, and `delete` must not follow it out.
  name: "delete refuses a path behind a staging junction that leads out",
  ignore: !WINDOWS,
  fn: () =>
    withLayout(async ({ tmp, proj, staging }) => {
      await Deno.mkdir(join(tmp, "outside/b"), { recursive: true });
      await Deno.writeTextFile(join(tmp, "outside/b/tool"), "outside\n");
      const args = ["/c", "mklink", "/J", join(staging, "a"), join(tmp, "outside")];
      const made = await new Deno.Command("cmd", { args, stdout: "null" }).output();
      assert(made.success, "mklink /J failed");
      await assertRejects(() => new FsStagingStore().delete(proj, REL), PathRefusal);
      assertEquals(await Deno.readTextFile(join(tmp, "outside/b/tool")), "outside\n");
    }),
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
