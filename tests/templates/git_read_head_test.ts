// `git-read.sh --head <sha> [--objects <dir>] <form>` reads that commit from git's objects: the
// head lives only in a separate objects folder, and the project's HEAD and index hold other
// files, so `files` and `base` can only answer as asserted by reading the head.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { headRepo } from "../scripts/explicit_head_fixture.ts";
import { gitRead } from "./git_read_fixture.ts";

const fixture = () =>
  headRepo({ "src/a.ts": "a\n" }, { "src/head_only.ts": "h\n" }, { "src/main_only.ts": "m\n" });

Deno.test("git-read --head: files lists the head's tree, not the index", async () => {
  const repo = await fixture();
  const r = await gitRead(
    ["--head", repo.head, "--objects", repo.objects, "files", "src"],
    repo.root,
  );
  assertEquals(r.code, 0, r.stderr);
  assertEquals(r.stdout.trim().split("\n"), ["src/a.ts", "src/head_only.ts"]);
});

Deno.test("git-read --head: base starts from the head, not from HEAD", async () => {
  const repo = await fixture();
  const r = await gitRead(
    ["--head", repo.head, "--objects", repo.objects, "base", "main"],
    repo.root,
  );
  assertEquals(r.code, 0, r.stderr);
  assertEquals(r.stdout.trim(), repo.base);
});

Deno.test("git-read --head: the head's objects are read by id in every form", async () => {
  const repo = await fixture();
  const head = ["--head", repo.head, "--objects", repo.objects];
  const names = await gitRead([...head, "names", repo.base, repo.head], repo.root);
  assertEquals(names.code, 0, names.stderr);
  assertEquals(names.stdout.trim(), "src/head_only.ts");
  const log = await gitRead([...head, "log", `${repo.base}..${repo.head}`], repo.root);
  assertStringIncludes(log.stdout, "the head's change");
});

Deno.test("git-read --head: no revision may spell HEAD", async () => {
  const repo = await fixture();
  const head = ["--head", repo.head, "--objects", repo.objects];
  const spellings = [
    ["log", "HEAD"],
    ["names", "main", "HEAD~1"],
    ["log", "main..@"],
    // Where the file system folds case, git resolves `head` to HEAD.
    ["log", "head"],
    ["names", "main", "Head^"],
  ];
  for (const args of spellings) {
    const r = await gitRead([...head, ...args], repo.root);
    assertEquals(r.code, 2, args.join(" ") + r.stdout);
    assertStringIncludes(r.stderr, "git-read: refused: ");
    assert(r.stdout === "", r.stdout);
  }
});

Deno.test("git-read --head: refuses a head it cannot reach, a short id, and objects alone", async () => {
  const repo = await fixture();
  const cases: [string[], string][] = [
    [["--head", repo.head, "files"], `--head: no commit ${repo.head} in reach`],
    [
      ["--head", repo.head.slice(0, 10), "--objects", repo.objects, "files"],
      "--head: not a full commit id",
    ],
    [
      ["--head", repo.head, "--objects", "relative/objects", "files"],
      "--head: not an absolute path",
    ],
    [["--objects", repo.objects, "files"], "--head: --objects needs --head"],
    [["--head", "", "files"], "--head takes a value"],
    [["--head", repo.head, "--objects", "", "files"], "--objects takes a value"],
    [["--head"], "--head takes a value"],
  ];
  for (const [args, why] of cases) {
    const r = await gitRead(args, repo.root);
    assertEquals(r.code, 2, args.join(" ") + r.stdout);
    assertStringIncludes(r.stderr, `git-read: refused: ${why}`);
  }
});
