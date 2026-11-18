import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { git } from "./git_sandbox.ts";
import { calls, lfsBranch, lfsShim } from "./lfs_push_fixture.ts";

/**
 * cli#799 — what `lfs-push.sh` refuses before any upload: a git-lfs that cannot be trusted to push,
 * and an `.lfsconfig` the branch controls. Each is exit 17 with nothing pushed; `land-feature.sh`
 * passes it through. `git lfs` is a shim; the shim is a bash script named `git` on PATH, and
 * Windows resolves `git.exe` first.
 */

const shimmed = { ignore: Deno.build.os === "windows" };
const pushed = async (log: string) => (await calls(log)).filter((c) => /^(lfs )?push /.test(c));

Deno.test(
  "git-lfs absent: 17 when an lfs filter is configured here, else it lands",
  shimmed,
  async () => {
    const sb = await lfsBranch();
    try {
      const log = join(sb.root, "git.log");
      const absent = lfsShim(log, "", "exit 1");
      // `cat` keeps the committed bytes: a refreshed index sees no change.
      await git(sb.work, "config", "filter.lfs.clean", "cat");
      const refused = await sb.scriptWithGit(absent, "land-feature.sh");
      assertEquals(refused.code, 17, refused.stderr);
      assertStringIncludes(refused.stderr, "LFS UNAVAILABLE");
      assertEquals(await pushed(log), []);
      await git(sb.work, "config", "--unset", "filter.lfs.clean");
      const landed = await sb.scriptWithGit(absent, "land-feature.sh");
      assertEquals(landed.code, 0, landed.stderr);
      assertStringIncludes(landed.stderr, "LFS skipped");
    } finally {
      await sb.cleanup();
    }
  },
);

Deno.test("git-lfs older than 2.13.3 is 17; 2.13.3 lands", shimmed, async () => {
  const sb = await lfsBranch();
  try {
    const log = join(sb.root, "git.log");
    const old = await sb.scriptWithGit(lfsShim(log, "git-lfs/2.13.2 (GitHub)"), "land-feature.sh");
    assertEquals(old.code, 17, old.stderr);
    assertStringIncludes(old.stderr, "LFS TOO OLD");
    assertEquals(await pushed(log), []);
    const floor = await sb.scriptWithGit(
      lfsShim(log, "git-lfs/2.13.3 (GitHub)"),
      "land-feature.sh",
    );
    assertEquals(floor.code, 0, floor.stderr);
  } finally {
    await sb.cleanup();
  }
});

Deno.test(
  "lfs-push.sh: a branch that changes .lfsconfig is 17, and nothing is pushed",
  shimmed,
  async () => {
    // The landing stops on it earlier without a yes (an instruction file); this is the --pr push,
    // and a yes that covered the change: neither lets the branch say where the objects go.
    const sb = await lfsBranch();
    try {
      await sb.commit(
        ".lfsconfig",
        "[lfs]\n\turl = https://lfs.example.test/x\n",
        "chore: lfs url",
      );
      const log = join(sb.root, "git.log");
      const r = await sb.scriptWithGit(lfsShim(log, "git-lfs/3.0.0"), "lfs-push.sh");
      assertEquals(r.code, 17, r.stderr);
      assertStringIncludes(r.stderr, "LFS CONFIG CHANGED");
      assertStringIncludes(r.stderr, "-- .lfsconfig");
      assertEquals(await pushed(log), []);
    } finally {
      await sb.cleanup();
    }
  },
);

Deno.test(
  "lfs-push.sh: an .lfsconfig git does not track is 17, the tree clean",
  shimmed,
  async () => {
    const sb = await lfsBranch();
    try {
      const text = "[lfs]\n\tallowincompletepush = true\n";
      await Deno.writeTextFile(join(sb.work, ".lfsconfig"), text);
      await Deno.mkdir(join(sb.work, ".git", "info"), { recursive: true });
      await Deno.writeTextFile(join(sb.work, ".git", "info", "exclude"), ".lfsconfig\n");
      assertEquals(await git(sb.work, "status", "--porcelain"), "");
      const log = join(sb.root, "git.log");
      const r = await sb.scriptWithGit(lfsShim(log, "git-lfs/3.0.0"), "lfs-push.sh");
      assertEquals(r.code, 17, r.stderr);
      assertStringIncludes(r.stderr, "LFS CONFIG CHANGED");
      assertEquals(await pushed(log), []);
    } finally {
      await sb.cleanup();
    }
  },
);

Deno.test("lfs-push.sh: no merge-base to compare .lfsconfig with is 17", shimmed, async () => {
  const sb = await lfsBranch();
  try {
    await git(sb.work, "update-ref", "-d", "refs/remotes/origin/main");
    const log = join(sb.root, "git.log");
    const r = await sb.scriptWithGit(lfsShim(log, "git-lfs/3.0.0"), "lfs-push.sh");
    assertEquals(r.code, 17, r.stderr);
    assertStringIncludes(r.stderr, "LFS CONFIG CHANGED");
    assertEquals(await pushed(log), []);
  } finally {
    await sb.cleanup();
  }
});

Deno.test(
  "lfs-push.sh: a commit other than HEAD is 2, and nothing is asked of git-lfs",
  shimmed,
  async () => {
    const sb = await lfsBranch();
    try {
      const base = await git(sb.work, "rev-parse", "main");
      const log = join(sb.root, "git.log");
      const r = await sb.scriptWithGit(lfsShim(log, "git-lfs/3.0.0"), "lfs-push.sh", base);
      assertEquals(r.code, 2, r.stderr);
      assertStringIncludes(r.stderr, "must be HEAD");
      const seen = await calls(log);
      assert(seen.length > 0, "the shim saw nothing: the test proves nothing");
      assertEquals(seen.filter((c) => c.startsWith("lfs")), []);
    } finally {
      await sb.cleanup();
    }
  },
);

Deno.test(
  "lfs-push.sh: an .lfsconfig tracked as a link is 17, even unchanged",
  shimmed,
  async () => {
    // git-lfs follows the link to a file no commit holds; the blob ids alone would read equal.
    const sb = await lfsBranch();
    try {
      await git(sb.work, "switch", "--quiet", "main");
      await Deno.symlink("elsewhere.ini", join(sb.work, ".lfsconfig"));
      await git(sb.work, "add", ".lfsconfig");
      await git(sb.work, "commit", "--quiet", "-m", "chore: lfs config link");
      await git(sb.work, "push", "--quiet", "origin", "main");
      await git(sb.work, "switch", "--quiet", "feature");
      await git(sb.work, "rebase", "--quiet", "main");
      const log = join(sb.root, "git.log");
      const r = await sb.scriptWithGit(lfsShim(log, "git-lfs/3.0.0"), "lfs-push.sh");
      assertEquals(r.code, 17, r.stderr);
      assertStringIncludes(r.stderr, "LFS CONFIG CHANGED");
      assertEquals(await pushed(log), []);
    } finally {
      await sb.cleanup();
    }
  },
);
