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
