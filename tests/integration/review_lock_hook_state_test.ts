import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { FsReviewLock } from "../../src/infrastructure/fs_review_lock.ts";
import { inProject, input, runHook } from "./review_lock_hook_fixture.ts";

/**
 * The lock hook's per-user folder, read as the binary reads it: a path on the way to it that the
 * hook cannot look into proves no absence, and a drive-letter `XDG_STATE_HOME` is a folder on a
 * Windows shell, as it is to the binary there.
 */

const POSIX = Deno.build.os !== "windows";

async function withFolders(fn: (state: string, bare: string) => Promise<void>) {
  const state = await Deno.makeTempDir({ prefix: "review-lock-state-" });
  const bare = await Deno.makeTempDir({ prefix: "review-lock-bare-" });
  try {
    await fn(state, bare);
  } finally {
    await Deno.chmod(join(state, "specnaut"), 0o700).catch(() => {});
    await Deno.remove(state, { recursive: true });
    await Deno.remove(bare, { recursive: true });
  }
}

/** Whether `dir` can be looked into all the same, as a privileged user can. */
async function searchable(dir: string): Promise<boolean> {
  return await Deno.lstat(join(dir, "x")).then(
    () => true,
    (e) => e instanceof Deno.errors.NotFound,
  );
}

/** The hook's exit and whether it started the binary, for session s-1 with `env`. */
async function hookIn(project: string, env: Record<string, string>, more = {}) {
  const run = await runHook(project, input("s-1"), 0, POSIX ? undefined : Deno.env.get("PATH"), {
    env,
    ...more,
  });
  return { code: run.code, judged: run.called !== null };
}

/** Whether the binary, its per-user folder below `state`, refuses session s-1 outside git. */
async function binaryRefuses(bare: string, state: string): Promise<void> {
  const lock = await FsReviewLock.open(bare, { state: join(state, "specnaut", "review-lock") });
  await assertRejects(() => lock.held("s-1"));
}

Deno.test({
  name: "a per-user folder the hook cannot look into counts as locked, as the binary reads it",
  ignore: !POSIX,
  fn: () =>
    withFolders(async (state, bare) => {
      const env = { XDG_STATE_HOME: state };
      await Deno.writeTextFile(join(state, "specnaut"), "");
      assertEquals(await hookIn(bare, env), { code: 2, judged: false }, "a file as its parent");
      await binaryRefuses(bare, state);
      await inProject(async (project) => {
        assertEquals(await hookIn(project, env), { code: 0, judged: true }, "judged in a repo");
      });
      await Deno.remove(join(state, "specnaut"));
      await Deno.mkdir(join(state, "specnaut"), { mode: 0o000 });
      if (!await searchable(join(state, "specnaut"))) {
        assertEquals((await hookIn(bare, env)).code, 2, "a parent it may not search");
        await binaryRefuses(bare, state);
      }
    }),
});

Deno.test({
  name: "a per-user folder that is plainly not there lets the call run, a dangling link included",
  ignore: !POSIX,
  fn: () =>
    withFolders(async (state, bare) => {
      const env = { XDG_STATE_HOME: state };
      assertEquals(await hookIn(bare, env), { code: 0, judged: false }, "nothing there");
      await Deno.symlink(join(state, "gone"), join(state, "specnaut"));
      assertEquals(await hookIn(bare, env), { code: 0, judged: false }, "a link to nowhere");
      const lock = await FsReviewLock.open(bare, { state: join(state, "specnaut", "review-lock") });
      assertEquals(await lock.held("s-1"), null, "the binary reads the same absence");
    }),
});

Deno.test("a drive-letter XDG_STATE_HOME is the per-user folder on a Windows shell", () =>
  withFolders(async (state, bare) => {
    // On Windows the folder is the temporary one, by its drive letter. Elsewhere bash is told it
    // is a Windows shell, and the same spelling resolves below the folder the hook starts in.
    const spelt = POSIX ? "C:\\state" : state;
    const folder = POSIX ? join(state, "C:", "state") : state;
    const copies = join(folder, "specnaut", "review-lock");
    await Deno.mkdir(copies, { recursive: true });
    await Deno.writeTextFile(join(copies, "s-1.json"), "{}");
    const home = join(state, "home");
    const env = { XDG_STATE_HOME: spelt, HOME: home, ...(POSIX ? { OSTYPE: "msys" } : {}) };
    assertEquals(await hookIn(bare, env, { cwd: state }), { code: 2, judged: false });
    if (POSIX) {
      const elsewhere = { ...env, OSTYPE: "linux-gnu" };
      assertEquals((await hookIn(bare, elsewhere, { cwd: state })).code, 0, "not on Windows");
    }
  }));
