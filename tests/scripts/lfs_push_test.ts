import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { git, sandbox } from "./git_sandbox.ts";
import { calls, lfsBranch, lfsShim, trackOnBase } from "./lfs_push_fixture.ts";

/**
 * cli#799 — the landing pushes with hooks off, so git-lfs's pre-push upload never runs:
 * `land-feature.sh` runs `lfs-push.sh`, which pushes the objects first, and a failure stops the
 * landing before anything moves. `git lfs` is a shim here; `lfs_push_e2e_test.ts` runs the real one.
 */

// The shim is a bash script named `git` on PATH; Windows resolves `git.exe` first.
const shimmed = { ignore: Deno.build.os === "windows" };
const lfsPush = (sha: string) => `lfs push origin ${sha}`;

Deno.test("a repository without LFS lands with no git lfs call at all", shimmed, async () => {
  const sb = await sandbox();
  try {
    await git(sb.work, "switch", "--quiet", "-c", "feature");
    await sb.commit("f", "x\n", "feat(7): a feature");
    const log = join(sb.root, "git.log");
    const r = await sb.scriptWithGit(lfsShim(log, "git-lfs/3.0.0"), "land-feature.sh");
    assertEquals(r.code, 0, r.stderr);
    const seen = await calls(log);
    // Positive control: the shim saw the landing's own push.
    assert(seen.some((c) => c.startsWith("push ")), seen.join("\n"));
    assertEquals(seen.filter((c) => c.startsWith("lfs")), []);
  } finally {
    await sb.cleanup();
  }
});

Deno.test(
  "the landing pushes the judged commit's LFS objects before the git push",
  shimmed,
  async () => {
    const sb = await lfsBranch();
    try {
      const head = await git(sb.work, "rev-parse", "HEAD");
      const log = join(sb.root, "git.log");
      const r = await sb.scriptWithGit(lfsShim(log, "git-lfs/3.0.0"), "land-feature.sh");
      assertEquals(r.code, 0, r.stderr);
      const seen = await calls(log);
      const lfs = seen.indexOf(lfsPush(head));
      assert(lfs >= 0, `no git lfs push of ${head}:\n${seen.join("\n")}`);
      assert(lfs < seen.findIndex((c) => c.startsWith("push ")), seen.join("\n"));
      assertEquals(await git(sb.remote, "rev-parse", "main"), head);
    } finally {
      await sb.cleanup();
    }
  },
);

Deno.test("a failing git lfs push is 17: named, redacted, and nothing moves", shimmed, async () => {
  const sb = await lfsBranch();
  try {
    const before = await git(sb.remote, "rev-parse", "main");
    const log = join(sb.root, "git.log");
    const fail = "echo 'denied: https://u:s3cret@lfs.example.test/x' >&2; exit 2";
    const r = await sb.scriptWithGit(lfsShim(log, "git-lfs/3.0.0", fail), "land-feature.sh");
    assertEquals(r.code, 17, r.stderr);
    assertStringIncludes(r.stderr, "LFS PUSH FAILED");
    assertStringIncludes(r.stderr, "https://<redacted>@lfs.example.test/x");
    assert(!r.stderr.includes("s3cret"), r.stderr);
    assertEquals((await calls(log)).filter((c) => c.startsWith("push ")), []);
    assertEquals(await git(sb.remote, "rev-parse", "main"), before);
    assertEquals(await git(sb.work, "rev-parse", "main"), before);
    assertEquals(await git(sb.work, "symbolic-ref", "--short", "HEAD"), "feature");
  } finally {
    await sb.cleanup();
  }
});

Deno.test(
  "a file added and removed inside the range still has its objects pushed",
  shimmed,
  async () => {
    const sb = await lfsBranch();
    try {
      await git(sb.work, "rm", "--quiet", "a.bin");
      await git(sb.work, "commit", "--quiet", "-m", "chore: drop the blob");
      const head = await git(sb.work, "rev-parse", "HEAD");
      const log = join(sb.root, "git.log");
      const r = await sb.scriptWithGit(lfsShim(log, "git-lfs/3.0.0"), "land-feature.sh");
      assertEquals(r.code, 0, r.stderr);
      assert((await calls(log)).includes(lfsPush(head)), (await calls(log)).join("\n"));
    } finally {
      await sb.cleanup();
    }
  },
);

Deno.test(
  "past 64 KB of attribute output, an LFS file listed first is still found",
  shimmed,
  async () => {
    // A reader that stops at the first match closes the pipe while git still writes: under
    // pipefail that failure would read as "no LFS".
    const sb = await sandbox();
    try {
      await trackOnBase(sb, "0.bin");
      await git(sb.work, "switch", "--quiet", "-c", "feature");
      await Deno.writeTextFile(join(sb.work, "0.bin"), "blob\n");
      await Deno.mkdir(join(sb.work, "many"));
      for (let i = 0; i < 1500; i++) {
        await Deno.writeTextFile(join(sb.work, "many", `${"f".repeat(40)}${i}`), "");
      }
      await git(sb.work, "add", ".");
      await git(sb.work, "commit", "--quiet", "-m", "feat(7): many files");
      const head = await git(sb.work, "rev-parse", "HEAD");
      const log = join(sb.root, "git.log");
      const r = await sb.scriptWithGit(lfsShim(log, "git-lfs/3.0.0"), "land-feature.sh");
      assertEquals(r.code, 0, r.stderr);
      assert((await calls(log)).includes(lfsPush(head)), "the LFS file went unseen");
    } finally {
      await sb.cleanup();
    }
  },
);

Deno.test("merge.md's --pr step pushes the LFS objects first, and stops the push on a failure", async () => {
  for (const root of ["templates/core/skills", "plugin/skills"]) {
    const doc = await Deno.readTextFile(
      new URL(`../../${root}/task/phases/merge.md`, import.meta.url),
    );
    const step = doc.match(/^2\. \*\*`--pr` only\*\*[\s\S]*?(?=^3\. )/m)?.[0] ?? "";
    assertStringIncludes(
      step.replace(/\s+/g, " "),
      "`bash .specnaut/scripts/bash/lfs-push.sh && git -c core.hooksPath=/dev/null push -u origin <branch>`",
      root,
    );
  }
});
