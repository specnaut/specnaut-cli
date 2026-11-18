import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { type GitFeature, gitTest } from "../integration/git_feature.ts";
import { git, run, type Sandbox, sandbox } from "./git_sandbox.ts";
import { trackOnBase } from "./lfs_push_fixture.ts";

/**
 * cli#799, with the real git-lfs and a bare origin on disk: an object reaches
 * `origin.git/lfs/objects` only through an LFS upload, and the landing pushes with hooks off, so
 * git-lfs's pre-push hook never ran it. Skipped off CI without git-lfs; CI fails without it.
 */

const LFS: GitFeature = {
  name: "git-lfs",
  present:
    (await new Deno.Command("git", { args: ["lfs", "version"], stdout: "null", stderr: "null" })
      .output().catch((e) => {
        // No git on the PATH reads as no git-lfs; any other failure is the test's to report.
        if (e instanceof Deno.errors.NotFound) return { success: false };
        throw e;
      })).success,
};

/** A feature branch adding `a.bin` through git-lfs's own filter; its object's path on origin. */
async function lfsFeature(): Promise<{ sb: Sandbox; oid: string; onOrigin: string }> {
  const sb = await sandbox();
  await git(sb.work, "lfs", "install", "--local");
  await trackOnBase(sb, "*.bin");
  await git(sb.work, "switch", "--quiet", "-c", "feature");
  await sb.commit("a.bin", "a blob\n", "feat(7): a blob");
  const oid = (await git(sb.work, "lfs", "ls-files", "--long")).split(" ")[0];
  const onOrigin = join(sb.remote, "lfs", "objects", oid.slice(0, 2), oid.slice(2, 4), oid);
  return { sb, oid, onOrigin };
}

const exists = (path: string) =>
  Deno.stat(path).then(() => true, (e) => {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  });

gitTest(LFS, "the landing uploads the branch's LFS objects to origin", async () => {
  const { sb, onOrigin } = await lfsFeature();
  try {
    assertEquals(await exists(onOrigin), false, "origin held the object before the landing");
    const r = await sb.script("land-feature.sh");
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stderr, "LFS pushed");
    assertEquals(await exists(onOrigin), true, "the landing pushed a pointer without its object");
  } finally {
    await sb.cleanup();
  }
});

gitTest(LFS, "the --pr chain uploads the objects before the branch is pushed", async () => {
  const { sb, onOrigin } = await lfsFeature();
  try {
    const r = await sb.script("lfs-push.sh");
    assertEquals(r.code, 0, r.stderr);
    assertEquals(await exists(onOrigin), true, "lfs-push.sh uploaded nothing");
    const push = await run("git", [
      "-c",
      "core.hooksPath=/dev/null",
      "push",
      "-q",
      "origin",
      "feature",
    ], sb.work);
    assertEquals(push.code, 0, push.stderr);
  } finally {
    await sb.cleanup();
  }
});

gitTest(
  LFS,
  "an object missing here is 17, though the config allows an incomplete push",
  async () => {
    // git-lfs reads `lfs.allowincompletepush` from the repository's config and from a branch's
    // .lfsconfig; with it, a missing object is a warning and the pointer lands without it.
    const { sb } = await lfsFeature();
    try {
      // A pointer committed as text: no clean of it, a refreshed index's included, stores an object.
      const oid = "0".repeat(63) + "1";
      const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 4\n`;
      await sb.commit("b.bin", pointer, "feat(7): a pointer whose object is nowhere");
      await git(sb.work, "config", "lfs.allowincompletepush", "true");
      // As a clone made with GIT_LFS_SKIP_SMUDGE: checking the pointer out passes, so only the upload
      // can stop the landing.
      await git(sb.work, "config", "filter.lfs.process", "git-lfs filter-process --skip");
      const before = await git(sb.remote, "rev-parse", "main");
      const r = await sb.script("land-feature.sh");
      assertEquals(r.code, 17, r.stderr);
      assertStringIncludes(r.stderr, "LFS PUSH FAILED");
      assertEquals(await git(sb.remote, "rev-parse", "main"), before);
    } finally {
      await sb.cleanup();
    }
  },
);
