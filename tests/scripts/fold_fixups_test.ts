import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { git, run, sandbox } from "./git_sandbox.ts";

/** spec 042 — fold-fixups.sh folds each fixup into its own child and proves nothing else moved. */

async function epicWithFixup() {
  const sb = await sandbox();
  await git(sb.work, "switch", "--quiet", "-c", "epic");
  const t01 = await sb.commit("a", "one\n", "feat(T01): a (#51)", "Epic: #50");
  await sb.commit("b", "two\n", "feat(T02): b (#52)", "Epic: #50");
  await Deno.writeTextFile(`${sb.work}/a`, "one, fixed\n");
  await git(sb.work, "commit", "--quiet", "-am", "x", `--fixup=${t01}`);
  return sb;
}

Deno.test("it prints PRE, folds the fixup into its own child, and keeps the tree", async () => {
  const sb = await epicWithFixup();
  try {
    const tree = await git(sb.work, "rev-parse", "HEAD^{tree}");
    const r = await sb.script("fold-fixups.sh");
    assertEquals(r.code, 0, r.stderr);
    assert(/^PRE [0-9a-f]{40}$/m.test(r.stdout), r.stdout);
    assertEquals(await git(sb.work, "rev-parse", "HEAD^{tree}"), tree);
    assertEquals((await git(sb.work, "log", "--format=%s", "main..HEAD")).split("\n"), [
      "feat(T02): b (#52)",
      "feat(T01): a (#51)",
    ]);
    assertEquals(await git(sb.work, "show", "HEAD~1:a"), "one, fixed");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("it folds on a git older than 2.44, where --autosquash needs --interactive", {
  // The shim is a bash script named `git` on PATH; Windows resolves `git.exe` first.
  ignore: Deno.build.os === "windows",
}, async () => {
  const sb = await epicWithFixup();
  try {
    // git < 2.44 ignores --autosquash unless the rebase is interactive.
    const r = await sb.scriptWithGit(
      `if [ "$1" = rebase ] && [[ " $* " != *" -i "* && " $* " != *" --interactive "* ]]; then
  args=(); for a in "$@"; do [ "$a" = --autosquash ] || args+=("$a"); done; set -- "\${args[@]}"
fi
exec "$REAL_GIT" "$@"`,
      "fold-fixups.sh",
    );
    assertEquals(r.code, 0, r.stderr);
    assertEquals(await git(sb.work, "rev-list", "--count", "main..HEAD"), "2");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a conflict stops at 13; --verify then checks against the tree recorded before", async () => {
  const sb = await sandbox();
  try {
    await git(sb.work, "switch", "--quiet", "-c", "epic");
    const t01 = await sb.commit("a", "1\n", "feat(T01): a (#51)", "Epic: #50");
    await sb.commit("a", "2\n", "feat(T02): a again (#52)", "Epic: #50");
    // A fixup of T01 that touches the line T02 rewrote: it cannot fold without a conflict.
    await Deno.writeTextFile(`${sb.work}/a`, "1 fixed\n");
    await git(sb.work, "commit", "--quiet", "-am", "x", `--fixup=${t01}`);
    const before = await git(sb.work, "rev-parse", "HEAD");
    const r = await sb.script("fold-fixups.sh");
    assertEquals(r.code, 13, r.stderr);
    // git's own conflict report reaches the reader: the script never prints a subject.
    assertStringIncludes(r.stderr, "fixup! feat(T01): a (#51)");
    const pre = r.stdout.match(/^PRE ([0-9a-f]{40})$/m)?.[1];
    assertEquals(pre, before);
    // Resolve keeping the branch's final content: the fold must not change the tree.
    await Deno.writeTextFile(`${sb.work}/a`, "1 fixed\n");
    await git(sb.work, "add", "a");
    await run("git", ["-c", "core.editor=true", "rebase", "--continue"], sb.work);
    await Deno.writeTextFile(`${sb.work}/a`, "1 fixed\n");
    if ((await git(sb.work, "status", "--porcelain")) !== "") {
      await git(sb.work, "add", "a");
      await run("git", ["-c", "core.editor=true", "rebase", "--continue"], sb.work);
    }
    const v = await sb.script("fold-fixups.sh", "--verify", pre!);
    assertEquals(v.code, 0, v.stdout + v.stderr);
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a tree that moved is 10, a dirty worktree 11, a surviving fixup 12", async () => {
  const sb = await epicWithFixup();
  try {
    const pre = await git(sb.work, "rev-parse", "HEAD");
    assertEquals((await sb.script("fold-fixups.sh")).code, 0);
    await sb.commit("c", "extra\n", "feat(T03): c (#53)", "Epic: #50");
    const moved = await sb.script("fold-fixups.sh", "--verify", pre);
    assertEquals(moved.code, 10, moved.stderr);
    await Deno.writeTextFile(`${sb.work}/stray`, "x\n");
    assertEquals((await sb.script("fold-fixups.sh")).code, 11);
  } finally {
    await sb.cleanup();
  }
  const hand = await sandbox();
  try {
    await git(hand.work, "switch", "--quiet", "-c", "epic");
    await hand.commit("a", "1\n", "feat(T01): a (#51)", "Epic: #50");
    // A fixup written by hand names a subject no commit has: autosquash cannot place it.
    await hand.commit("a", "2\n", "fixup! no such child");
    const r = await hand.script("fold-fixups.sh");
    assertEquals(r.code, 12, r.stderr);
    assertStringIncludes(r.stderr, "a fixup! survived");
  } finally {
    await hand.cleanup();
  }
});

Deno.test("--verify takes only a sha; any other argument is usage", async () => {
  const sb = await sandbox();
  try {
    for (const args of [["main"], ["--verify"], ["--verify", "HEAD;rm"]]) {
      assertEquals((await sb.script("fold-fixups.sh", ...args)).code, 2, args.join(" "));
    }
  } finally {
    await sb.cleanup();
  }
});
