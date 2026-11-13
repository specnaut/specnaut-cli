import { assertEquals, assertStringIncludes } from "@std/assert";
import { git, type Sandbox, sandbox } from "./git_sandbox.ts";
import { shim } from "./git_shim.ts";

/**
 * land-feature.sh lands the commit it judged, and only that commit: the branch's name is read once,
 * as HEAD, and the fast-forward and the push carry exactly that commit.
 */

async function featureBranch(): Promise<Sandbox> {
  const sb = await sandbox();
  await git(sb.work, "switch", "--quiet", "-c", "feature");
  await sb.commit("f", "x\n", "feat(7): a feature");
  return sb;
}

Deno.test("a branch that moves after the judgement still lands the judged commit", {
  // The shim is a bash script named `git` on PATH; Windows resolves `git.exe` first.
  ignore: Deno.build.os === "windows",
}, async () => {
  const sb = await featureBranch();
  try {
    const judged = await git(sb.work, "rev-parse", "HEAD");
    const later = await git(sb.work, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "later");
    const r = await sb.scriptWithGit(
      shim(`[ "$1" = merge ] && "$REAL_GIT" update-ref refs/heads/feature ${later}`),
      "land-feature.sh",
    );
    // The branch now holds a commit main lacks, so it will not delete: landed, 11.
    assertEquals(r.code, 11, r.stderr);
    assertEquals(await git(sb.remote, "rev-parse", "main"), judged);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a local base that already holds the branch and more is 6: nothing pushed", async () => {
  const sb = await featureBranch();
  try {
    const before = await git(sb.remote, "rev-parse", "main");
    await git(sb.work, "checkout", "--quiet", "main");
    await git(sb.work, "merge", "--quiet", "--ff-only", "feature");
    const extra = await sb.commit("l", "l\n", "chore: local only");
    await git(sb.work, "checkout", "--quiet", "feature");
    const r = await sb.script("land-feature.sh");
    assertEquals(r.code, 6, r.stderr);
    assertStringIncludes(r.stderr, "chore: local only");
    assertEquals(await git(sb.remote, "rev-parse", "main"), before);
    assertEquals(await git(sb.work, "rev-parse", "main"), extra);
    assertEquals(await git(sb.work, "symbolic-ref", "--short", "HEAD"), "feature");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a git failure inside the landing's git wrapper is 12, named, nothing pushed", {
  // The shim is a bash script named `git` on PATH; Windows resolves `git.exe` first.
  ignore: Deno.build.os === "windows",
}, async () => {
  const sb = await featureBranch();
  try {
    const before = await git(sb.remote, "rev-parse", "main");
    const r = await sb.scriptWithGit(shim(`[ "$1" = checkout ] && exit 1`), "land-feature.sh");
    assertEquals(r.code, 12, r.stderr);
    assertStringIncludes(r.stderr, 'checkout --quiet "$base"');
    assertStringIncludes(r.stderr, "nothing was pushed");
    assertEquals(await git(sb.remote, "rev-parse", "main"), before);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a git failure inside a command substitution is named once", {
  // The shim is a bash script named `git` on PATH; Windows resolves `git.exe` first.
  ignore: Deno.build.os === "windows",
}, async () => {
  const sb = await featureBranch();
  try {
    const r = await sb.scriptWithGit(shim(`[ "$1" = rev-list ] && exit 128`), "land-feature.sh");
    assertEquals(r.code, 12, r.stderr);
    assertEquals(r.stderr.match(/unexpected failure/g)?.length, 1, r.stderr);
    assertStringIncludes(r.stderr, "rev-list");
  } finally {
    await sb.cleanup();
  }
});
