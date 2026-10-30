import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { git, run, sandbox } from "./git_sandbox.ts";

/** spec 042 — land-feature.sh is the one home of the mechanical merge. */

async function featureBranch() {
  const sb = await sandbox();
  await git(sb.work, "switch", "--quiet", "-c", "feature");
  await sb.commit("f", "x\n", "feat(7): a feature");
  return sb;
}

Deno.test("it lands, pushes, deletes the branch, ends on the base, and says LANDED", async () => {
  const sb = await featureBranch();
  try {
    const head = await git(sb.work, "rev-parse", "HEAD");
    const r = await sb.script("land-feature.sh");
    assertEquals(r.code, 0, r.stderr);
    assert(/^LANDED main [0-9a-f]{12}\.\.[0-9a-f]{12} 1 commit\(s\)$/m.test(r.stdout), r.stdout);
    assertEquals(await git(sb.work, "symbolic-ref", "--short", "HEAD"), "main");
    assertEquals(await git(sb.remote, "rev-parse", "main"), head);
    assertEquals(await git(sb.work, "branch", "--list", "feature"), "");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("its refusals: on the base 2, no base 3, dirty 4, behind 5", async () => {
  const sb = await featureBranch();
  try {
    assertEquals((await sb.script("land-feature.sh", "main")).code, 2, "an argument");
    await Deno.writeTextFile(join(sb.work, "f"), "dirty\n");
    assertEquals((await sb.script("land-feature.sh")).code, 4);
    await git(sb.work, "checkout", "--quiet", "f");
    // Someone else moves origin/main: the branch no longer contains it.
    const other = join(sb.root, "other");
    await git(sb.root, "clone", "--quiet", sb.remote, other);
    await Deno.writeTextFile(join(other, "o"), "o\n");
    await git(other, "add", "o");
    await run("git", [
      "-c",
      "user.name=o",
      "-c",
      "user.email=o@example.test",
      "commit",
      "--quiet",
      "-m",
      "theirs",
    ], other);
    await git(other, "push", "--quiet", "origin", "main");
    assertEquals((await sb.script("land-feature.sh")).code, 5);
    await git(sb.work, "checkout", "--quiet", "main");
    assertEquals((await sb.script("land-feature.sh")).code, 2, "on the base");
    await git(sb.work, "remote", "set-head", "origin", "--delete");
    // No origin/HEAD and, isolated from the user's own config, no init.defaultBranch.
    const empty = join(sb.root, "empty.gitconfig");
    await Deno.writeTextFile(empty, "");
    const noBase = await run("bash", [".specnaut/scripts/bash/land-feature.sh"], sb.work, {
      GIT_CONFIG_GLOBAL: empty,
      GIT_CONFIG_NOSYSTEM: "1",
    });
    assertEquals(noBase.code, 3, "no base");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a rejected push is 7, leaves the merge local, and a re-run after reconciling lands", async () => {
  const sb = await featureBranch();
  try {
    await sb.refusePushes();
    const r = await sb.script("land-feature.sh");
    assertEquals(r.code, 7, r.stderr);
    assertStringIncludes(r.stderr, "never --force");
    assertEquals(await git(sb.work, "symbolic-ref", "--short", "HEAD"), "main");
    assert((await git(sb.remote, "log", "--format=%s", "main")).includes("feat(7)") === false);
    await Deno.writeTextFile(join(sb.root, "allow"), "");
    await git(sb.work, "checkout", "--quiet", "feature");
    const again = await sb.script("land-feature.sh");
    assertEquals(again.code, 0, again.stderr);
    assertStringIncludes(await git(sb.remote, "log", "--format=%s", "main"), "feat(7)");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("it never publishes a tag, even with push.followTags set", async () => {
  const sb = await featureBranch();
  try {
    await git(sb.work, "config", "push.followTags", "true");
    await git(sb.work, "tag", "-a", "v9.9.9", "-m", "local only");
    assertEquals((await sb.script("land-feature.sh")).code, 0);
    assertEquals(await git(sb.remote, "tag", "--list"), "", "a tag rode along on the push");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("every merge script finds base-branch.sh when run by bare name from its own directory", async () => {
  // `${BASH_SOURCE[0]%/*}` of a bare name is the name itself, and of a
  // Windows path with backslashes the whole path: the sibling went unfound (3).
  const sb = await sandbox();
  try {
    const dir = join(sb.work, ".specnaut/scripts/bash");
    // On main, with no feature: each stops at its own refusal, past the base lookup.
    const want: Record<string, [number, ...string[]]> = {
      "epic-status.sh": [14],
      "fold-fixups.sh": [14],
      "land-feature.sh": [2],
      "remove-spec.sh": [22, "007-x"],
    };
    for (const [name, [code, ...args]] of Object.entries(want)) {
      const r = await run("bash", [name, ...args], dir);
      assertEquals(r.code, code, `${name}: ${r.stderr}`);
    }
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a local base ahead of origin is 6: the range is printed, nothing is rebased or pushed", async () => {
  // By the fast-forward the branch already contains origin/<base>, so exit 6
  // can only mean the local base holds commits origin lacks — a fact to stop on.
  const sb = await sandbox();
  try {
    const local = await sb.commit("l", "l\n", "chore: local only");
    await git(sb.work, "switch", "--quiet", "-c", "feature", "origin/main");
    const head = await sb.commit("f", "x\n", "feat(7): a feature");
    const before = await git(sb.remote, "rev-parse", "main");
    const r = await sb.script("land-feature.sh");
    assertEquals(r.code, 6, r.stderr);
    assertStringIncludes(r.stderr, "origin/main..main");
    assertStringIncludes(r.stderr, local.slice(0, 7));
    assertStringIncludes(r.stderr, "chore: local only");
    assertEquals(await git(sb.work, "symbolic-ref", "--short", "HEAD"), "feature");
    assertEquals(await git(sb.work, "rev-parse", "HEAD"), head, "the branch was rewritten");
    assertEquals(await git(sb.work, "rev-parse", "main"), local);
    assertEquals(await git(sb.remote, "rev-parse", "main"), before);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a branch with nothing origin lacks is 10, never a LANDED of 0 commits", async () => {
  const sb = await sandbox();
  try {
    await git(sb.work, "switch", "--quiet", "-c", "feature");
    const r = await sb.script("land-feature.sh");
    assertEquals(r.code, 10, r.stderr);
    assertEquals(r.stdout, "");
    assertStringIncludes(r.stderr, "nothing to land");
    assertEquals(await git(sb.work, "symbolic-ref", "--short", "HEAD"), "feature");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("origin's default must be exactly refs/heads/<base>: another branch is 3", async () => {
  // `team/main` ends in `main`: a tail match would have passed it.
  const sb = await featureBranch();
  try {
    await git(sb.work, "push", "--quiet", "origin", "main:refs/heads/team/main");
    await git(sb.remote, "symbolic-ref", "HEAD", "refs/heads/team/main");
    const r = await sb.script("land-feature.sh");
    assertEquals(r.code, 3, r.stderr);
    assertStringIncludes(r.stderr, "refs/heads/team/main");
    assertEquals(await git(sb.work, "symbolic-ref", "--short", "HEAD"), "feature");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("an origin that cannot answer is 3: unreachable, or its ls-remote fails", {
  ignore: Deno.build.os === "windows",
}, async () => {
  const sb = await featureBranch();
  try {
    const failing = await sb.scriptWithGit(
      `[ "$1" = ls-remote ] && exit 128\nexec "$REAL_GIT" "$@"`,
      "land-feature.sh",
    );
    assertEquals(failing.code, 3, failing.stderr);
    assertStringIncludes(failing.stderr, "ls-remote");
    const silent = await sb.scriptWithGit(
      `[ "$1" = ls-remote ] && exit 0\nexec "$REAL_GIT" "$@"`,
      "land-feature.sh",
    );
    assertEquals(silent.code, 3, "an answer naming no default is not a match");
    await git(sb.work, "remote", "set-url", "origin", join(sb.root, "gone.git"));
    const gone = await sb.script("land-feature.sh");
    assertEquals(gone.code, 3, gone.stderr);
    assertEquals(await git(sb.work, "symbolic-ref", "--short", "HEAD"), "feature");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a branch that will not delete after the push is 11 — landed, not a push failure", {
  ignore: Deno.build.os === "windows",
}, async () => {
  const sb = await featureBranch();
  try {
    const head = await git(sb.work, "rev-parse", "HEAD");
    const r = await sb.scriptWithGit(
      `[ "$1" = branch ] && [ "$3" = -d ] && exit 1\nexec "$REAL_GIT" "$@"`,
      "land-feature.sh",
    );
    assertEquals(r.code, 11, r.stderr);
    assert(/^LANDED main [0-9a-f]{12}\.\.[0-9a-f]{12} 1 commit\(s\)$/m.test(r.stdout), r.stdout);
    assertEquals(await git(sb.remote, "rev-parse", "main"), head);
    assertStringIncludes(r.stderr, "landed and pushed");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("an unexpected git failure is 12, named — never a raw set -e code", {
  ignore: Deno.build.os === "windows",
}, async () => {
  const sb = await featureBranch();
  try {
    const r = await sb.scriptWithGit(
      `[ "$1" = rev-parse ] && [ "$2" = HEAD ] && exit 128\nexec "$REAL_GIT" "$@"`,
      "land-feature.sh",
    );
    assertEquals(r.code, 12, r.stderr);
    assertStringIncludes(r.stderr, "rev-parse HEAD");
    assertStringIncludes(r.stderr, "nothing was pushed");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("the exit-7 recovery merge.md maps lands the branch after origin moved", async () => {
  // Exit 7 leaves the fast-forward on the local base: without resetting it,
  // the rebase that exit 5 asks for ends at exit 6, and the landing loops.
  const sb = await featureBranch();
  try {
    await sb.refusePushes();
    assertEquals((await sb.script("land-feature.sh")).code, 7);
    await Deno.writeTextFile(join(sb.root, "allow"), "");
    const other = join(sb.root, "other");
    await git(sb.root, "clone", "--quiet", sb.remote, other);
    await Deno.writeTextFile(join(other, "o"), "o\n");
    await git(other, "add", "o");
    await git(
      other,
      "-c",
      "user.name=o",
      "-c",
      "user.email=o@example.test",
      "commit",
      "-qm",
      "theirs",
    );
    await git(other, "push", "--quiet", "origin", "main");
    // The recovery, as merge.md writes it.
    await git(sb.work, "checkout", "--quiet", "feature");
    await git(sb.work, "branch", "-f", "main", "refs/remotes/origin/main");
    assertEquals((await sb.script("land-feature.sh")).code, 5);
    await git(sb.work, "rebase", "--quiet", "refs/remotes/origin/main");
    const r = await sb.script("land-feature.sh");
    assertEquals(r.code, 0, r.stderr);
    const log = await git(sb.remote, "log", "--format=%s", "main");
    assertStringIncludes(log, "feat(7)");
    assertStringIncludes(log, "theirs");
  } finally {
    await sb.cleanup();
  }
});
