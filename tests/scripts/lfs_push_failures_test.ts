import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { git, sandbox } from "./git_sandbox.ts";
import { shim } from "./git_shim.ts";
import { calls, lfsBranch, lfsShim } from "./lfs_push_fixture.ts";

/**
 * cli#799 — `lfs-push.sh` fails closed: a git call that fails is its exit 12, never an absent
 * file or a clean tree, and the landing turns that into its own 12 with nothing moved; a range
 * that touches a `.gitattributes` counts as LFS, since HEAD's attributes may no longer mark what
 * the range committed. The shim is a bash script named `git` on PATH; Windows resolves `git.exe`
 * first.
 */

const shimmed = { ignore: Deno.build.os === "windows" };

Deno.test(
  "an lfs-push.sh failure other than 17 is the landing's 12, nothing moved",
  shimmed,
  async () => {
    const sb = await sandbox();
    try {
      await git(sb.work, "switch", "--quiet", "-c", "feature");
      await sb.commit("f", "x\n", "feat(7): a feature");
      const before = await git(sb.remote, "rev-parse", "main");
      const r = await sb.scriptWithGit(
        shim(`[ "$1" = check-attr ] && exit 128`),
        "land-feature.sh",
      );
      assertEquals(r.code, 12, r.stderr);
      assertStringIncludes(r.stderr, "lfs-push.sh failed");
      assertEquals(await git(sb.remote, "rev-parse", "main"), before);
      assertEquals(await git(sb.work, "symbolic-ref", "--short", "HEAD"), "feature");
    } finally {
      await sb.cleanup();
    }
  },
);

Deno.test(
  "lfs-push.sh: a range that deletes a nested .gitattributes still pushes",
  shimmed,
  async () => {
    const sb = await sandbox();
    try {
      await sb.commit("sub/.gitattributes", "*.bin filter=lfs -text\n", "chore: lfs in sub");
      await git(sb.work, "push", "--quiet", "origin", "main");
      await git(sb.work, "switch", "--quiet", "-c", "feature");
      await sb.commit("sub/a.bin", "blob\n", "feat(7): a blob");
      await git(sb.work, "rm", "--quiet", "sub/.gitattributes");
      await git(sb.work, "commit", "--quiet", "-m", "chore: sub stops tracking");
      const head = await git(sb.work, "rev-parse", "HEAD");
      const log = join(sb.root, "git.log");
      const r = await sb.scriptWithGit(lfsShim(log, "git-lfs/3.0.0"), "lfs-push.sh");
      assertEquals(r.code, 0, r.stderr);
      assertEquals((await calls(log)).includes(`lfs push origin ${head}`), true, r.stdout);
    } finally {
      await sb.cleanup();
    }
  },
);

Deno.test(
  "lfs-push.sh: a failing ls-tree of .lfsconfig is 12, never an absent file",
  shimmed,
  async () => {
    const sb = await lfsBranch();
    try {
      const revs = {
        head: await git(sb.work, "rev-parse", "HEAD"),
        base: await git(sb.work, "rev-parse", "main"),
      };
      for (const [name, rev] of Object.entries(revs)) {
        const log = join(sb.root, `git-${name}.log`);
        const fail = `[ "$1" = ls-tree ] && [ "$2" = ${rev} ] && exit 128`;
        const r = await sb.scriptWithGit(
          lfsShim(log, "git-lfs/3.0.0", "exit 0", fail),
          "lfs-push.sh",
        );
        assertEquals(r.code, 12, `${name}: ${r.stderr}`);
        assertEquals((await calls(log)).filter((c) => c.startsWith("lfs push")), [], name);
      }
    } finally {
      await sb.cleanup();
    }
  },
);

Deno.test("lfs-push.sh: a failing status is 12, never a clean tree", shimmed, async () => {
  const sb = await lfsBranch();
  try {
    const log = join(sb.root, "git.log");
    const fail = `[ "$1" = status ] && exit 128`;
    const r = await sb.scriptWithGit(lfsShim(log, "git-lfs/3.0.0", "exit 0", fail), "lfs-push.sh");
    assertEquals(r.code, 12, r.stderr);
    assertStringIncludes(
      r.stderr,
      "lfs-push: unexpected failure (exit 128) of: dirty=$(git status --porcelain) - nothing was pushed\n",
    );
  } finally {
    await sb.cleanup();
  }
});

Deno.test(
  "lfs-push.sh: a failed push's output keeps no credential a URL carries, in any case",
  shimmed,
  async () => {
    const sb = await lfsBranch();
    try {
      // Each value is a secret; each name, and every other parameter, stays readable.
      const urls = [
        "https://u:v-user@lfs.example.test/x",
        "https://s3.example.test/o?X-Amz-Signature=v-amzsig&x-amz-security-token=v-amztok",
        "https://lfs.example.test/o?SIG=v-sig&Token=v-token&keep=shown",
        "https://lfs.example.test/o?a=1&Access_Token=v-access then more",
      ];
      const fail = `printf '%s\\n' ${urls.map((u) => `'${u}'`).join(" ")} >&2; exit 2`;
      const log = join(sb.root, "git.log");
      const r = await sb.scriptWithGit(lfsShim(log, "git-lfs/3.0.0", fail), "lfs-push.sh");
      assertEquals(r.code, 17, r.stderr);
      assertEquals(r.stderr.match(/v-[a-z]+/g), null, r.stderr);
      for (
        const kept of [
          "https://<redacted>@lfs.example.test/x",
          "?X-Amz-Signature=<redacted>&x-amz-security-token=<redacted>\n",
          "?SIG=<redacted>&Token=<redacted>&keep=shown",
          "?a=1&Access_Token=<redacted> then more",
        ]
      ) assertStringIncludes(r.stderr, kept);
    } finally {
      await sb.cleanup();
    }
  },
);
