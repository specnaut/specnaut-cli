// `boundary-check.sh --head <sha> [--objects <dir>]` checks that commit's tree, each file read as
// its blob by id from git's objects. The project's work tree and HEAD hold a different violation
// from the head's, so the file a report names says which one was read.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { BOUNDARIES_CONFIG_PATH } from "../../src/domain/constitution_paths.ts";
import { bashScript, exportHead, git, headRepo } from "./explicit_head_fixture.ts";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import { IDENTITY, run } from "../templates/child_fixture.ts";

const SCRIPT = fromFileUrl(
  new URL("../../templates/core/specnaut/scripts/bash/boundary-check.sh", import.meta.url),
);
const CONFIG = {
  [BOUNDARIES_CONFIG_PATH]:
    "domain:\n  - 'src/domain'\nforbid:\n  - '^import .* from \"web-framework\"'\n",
};
const VIOLATION = 'export const a = 1;\nimport x from "web-framework";\n';
const CLEAN = "export const a = 1;\n";

const check = (cwd: string, args: string[]) => bashScript(SCRIPT, args, cwd);

/** The head breaks `b.ts` and fixes `a.ts`; main and the work tree break `a.ts` only. */
async function split(headB = VIOLATION) {
  const repo = await headRepo(
    { ...CONFIG, "src/domain/a.ts": CLEAN },
    { "src/domain/a.ts": CLEAN, "src/domain/b.ts": headB },
    { "src/domain/a.ts": VIOLATION },
  );
  await Deno.writeTextFile(join(repo.root, "src/domain/a.ts"), VIOLATION + VIOLATION);
  return repo;
}

Deno.test("boundary check --head: reports the head's file, read from its objects folder", async () => {
  const repo = await split();
  const r = await check(repo.root, ["--head", repo.head, "--objects", repo.objects]);
  assertEquals(r.code, 1, r.stdout + r.stderr);
  assertStringIncludes(r.stderr, "src/domain/b.ts:2: ");
  assertStringIncludes(r.stderr, "1 forbidden import(s) in 2 file(s)");
  assert(!r.stderr.includes("src/domain/a.ts"), r.stderr);
});

Deno.test("boundary check --head: a clean head passes whatever the work tree holds", async () => {
  const repo = await split(CLEAN);
  const r = await check(repo.root, ["--head", repo.head, "--objects", repo.objects]);
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, "boundary-check: 2 file(s) under domain: clean of 1 pattern(s)");
});

// After --end-of-options, a `--` is one more path to ls-tree: a file of that name, outside
// every domain, was checked as if it were inside one.
Deno.test("boundary check --head: only the domain's files are listed, not one named --", async () => {
  const repo = await split(CLEAN);
  const outside = await exportHead(repo.root, {
    "--": VIOLATION,
    "src/domain/a.ts": CLEAN,
    "src/domain/b.ts": CLEAN,
  });
  const r = await check(repo.root, ["--head", outside.head, "--objects", outside.objects]);
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, "boundary-check: 2 file(s) under domain: clean");
});

Deno.test("boundary check --head: a head the repository cannot reach is refused, never discovered", async () => {
  const repo = await split();
  const r = await check(repo.root, ["--head", repo.head]);
  assertEquals(r.code, 2, r.stdout + r.stderr);
  assertStringIncludes(r.stderr, `boundary-check: --head: no commit ${repo.head} in reach`);
});

Deno.test("boundary check: --objects needs --head, and any other argument is refused", async () => {
  const repo = await split();
  const cases: [string[], string][] = [
    [["--objects", repo.objects], "boundary-check: --head: --objects needs --head"],
    [["--since", repo.base], "usage: boundary-check.sh [--head <sha> [--objects <dir>]]"],
  ];
  for (const [args, why] of cases) {
    const r = await check(repo.root, args);
    assertEquals(r.code, 2, args.join(" ") + r.stderr);
    assertStringIncludes(r.stderr, why);
  }
});

Deno.test("boundary check: an empty --head or --objects is refused, never read as none", async () => {
  const repo = await split();
  for (const args of [["--head", ""], ["--head", repo.head, "--objects", ""]]) {
    const r = await check(repo.root, args);
    assertEquals(r.code, 2, args.join(" ") + r.stdout + r.stderr);
    assertStringIncludes(r.stderr, `boundary-check: ${args.at(-2)} takes a value`);
  }
});

// Without a head the files are read in the work tree, and the object each entry carries is
// the index's: never the stage number that ends an index record. The trace shows each value.
Deno.test("boundary check: without a head, each file's object is its blob id", async () => {
  const repo = await split();
  const blob = await git(repo.root, "rev-parse", ":src/domain/a.ts");
  const r = await run("bash", ["-x", bashPath(SCRIPT)], repo.root, IDENTITY);
  assertEquals(r.code, 1, r.stdout + r.stderr);
  const traced = r.stderr.split("\n").filter((l) => /^\++ object=/.test(l));
  assertEquals(traced.map((l) => l.replace(/^\++ /, "")), [`object=${blob}`]);
});

/** `git <args>` fed `stdin`, its output's id. */
async function fed(root: string, stdin: string, ...args: string[]): Promise<string> {
  const r = await run("git", args, root, IDENTITY, stdin);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

/** A tree object of `ls-tree`-style entries, as written: `git mktree` keeps a repeated name. */
const mktree = (root: string, entries: string[]) =>
  fed(root, entries.map((e) => `${e}\n`).join(""), "mktree");

// A tree may name one path twice, with two blobs. A path is skipped as already read only when its
// blob repeats too: a head's second entry is not the work tree's conflicted stage of the first.
Deno.test("boundary check --head: a path named twice in a tree has both blobs read", async () => {
  const repo = await split(CLEAN);
  const clean = await fed(repo.root, CLEAN, "hash-object", "-w", "--stdin");
  const bad = await fed(repo.root, VIOLATION, "hash-object", "-w", "--stdin");
  const domain = await mktree(repo.root, [
    `100644 blob ${clean}\ta.ts`,
    `100644 blob ${bad}\ta.ts`,
  ]);
  const src = await mktree(repo.root, [`040000 tree ${domain}\tdomain`]);
  const top = await mktree(repo.root, [`040000 tree ${src}\tsrc`]);
  const head = await git(repo.root, "commit-tree", top, "-m", "a tree naming a.ts twice");
  const listed = await git(repo.root, "ls-tree", "-r", head);
  assertEquals(listed.split("\n").map((l) => l.split("\t")[0].split(" ")[2]), [clean, bad]);
  const r = await check(repo.root, ["--head", head]);
  assertEquals(r.code, 1, r.stdout + r.stderr);
  assertStringIncludes(r.stderr, "src/domain/a.ts:2: ");
});
