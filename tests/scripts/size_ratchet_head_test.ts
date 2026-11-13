// `size-ratchet.sh --since <ref> --head <sha> [--objects <dir>]` measures that commit, read from
// git's objects only: the head lives in a separate objects folder, and the project's HEAD, index
// and work tree hold other sizes, so the numbers asserted can come from nowhere else.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { SIZE_LIMITS_CONFIG_PATH } from "../../src/domain/constitution_paths.ts";
import { bashScript, headRepo } from "./explicit_head_fixture.ts";
import { FILE, lines, SCRIPT } from "./size_ratchet_fixture.ts";
import { IDENTITY, run } from "../templates/child_fixture.ts";

const config = { [SIZE_LIMITS_CONFIG_PATH]: FILE(20, 25) };

/** `big.ts` at 10 lines on main; the head grows it to 30; the project's work tree to 40. */
async function grown() {
  const repo = await headRepo(
    { ...config, "big.ts": lines(10) },
    { "big.ts": lines(30) },
    { "big.ts": lines(12) },
  );
  await Deno.writeTextFile(join(repo.root, "big.ts"), lines(40));
  return repo;
}

const ratchet = (cwd: string, args: string[]) => bashScript(SCRIPT, args, cwd);

Deno.test("size ratchet --head: measures the head from its objects folder, not HEAD or the tree", async () => {
  const repo = await grown();
  const r = await ratchet(repo.root, [
    "--since",
    repo.base,
    "--head",
    repo.head,
    "--objects",
    repo.objects,
    "--report",
  ]);
  assertEquals(r.code, 1, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, "  big.ts: 10 → 30\n");
  assertStringIncludes(r.stderr, `changed since ${repo.base} up to ${repo.head}`);
  assert(!r.stdout.includes("→ 40") && !r.stdout.includes("→ 12"), r.stdout);
});

Deno.test("size ratchet --head: a head the repository cannot reach is refused, never discovered", async () => {
  const repo = await grown();
  const r = await ratchet(repo.root, ["--since", repo.base, "--head", repo.head]);
  assertEquals(r.code, 3, r.stdout + r.stderr);
  assertStringIncludes(r.stderr, `size-ratchet: --head: no commit ${repo.head} in reach`);
});

Deno.test("size ratchet --head: only a full commit id is a head", async () => {
  const repo = await grown();
  for (const head of ["HEAD", repo.head.slice(0, 12), repo.head.toUpperCase(), `${repo.head}~1`]) {
    const r = await ratchet(repo.root, [
      "--since",
      repo.base,
      "--head",
      head,
      "--objects",
      repo.objects,
    ]);
    assertEquals(r.code, 3, head + r.stderr);
    assertStringIncludes(r.stderr, `--head: not a full commit id: ${head}`);
  }
});

Deno.test("size ratchet --head: needs --since, and --objects needs --head", async () => {
  const repo = await grown();
  const cases: [string[], string][] = [
    [["--head", repo.head, "--objects", repo.objects], "usage: size-ratchet.sh"],
    [["--since", repo.base, "--objects", repo.objects], "--head: --objects needs --head"],
  ];
  for (const [args, why] of cases) {
    const r = await ratchet(repo.root, args);
    assertEquals(r.code, 3, args.join(" ") + r.stderr);
    assertStringIncludes(r.stderr, why);
  }
});

Deno.test("size ratchet --head: an empty --head or --objects is refused, never read as none", async () => {
  const repo = await grown();
  for (
    const args of [
      ["--since", repo.base, "--head", ""],
      ["--since", repo.base, "--head", repo.head, "--objects", ""],
    ]
  ) {
    const r = await ratchet(repo.root, args);
    assertEquals(r.code, 3, args.join(" ") + r.stdout + r.stderr);
    assertStringIncludes(r.stderr, `size-ratchet: ${args.at(-2)} takes a value`);
  }
});

// A base is where the branch lands, so it comes from the project's own objects: the objects
// folder holds the branch's commits, and a base found only there was never the project's.
Deno.test("size ratchet --head: a base only the objects folder holds is not a commit", async () => {
  const repo = await grown();
  const r = await ratchet(repo.root, [
    "--since",
    repo.head,
    "--head",
    repo.head,
    "--objects",
    repo.objects,
  ]);
  assertEquals(r.code, 3, r.stdout + r.stderr);
  assertStringIncludes(r.stderr, `size-ratchet: not a commit: ${repo.head}`);
});

// Given a head, no git variable the caller exported is kept: alternates it inherits would make a
// base found only in the objects folder resolve, as if it were the project's.
Deno.test("size ratchet --head: inherited alternates do not make a base a commit", async () => {
  const repo = await grown();
  const args = ["--since", repo.head, "--head", repo.head, "--objects", repo.objects];
  const inherited = { GIT_ALTERNATE_OBJECT_DIRECTORIES: repo.objects };
  const r = await bashScript(SCRIPT, args, repo.root, inherited);
  assertEquals(r.code, 3, r.stdout + r.stderr);
  assertStringIncludes(r.stderr, `size-ratchet: not a commit: ${repo.head}`);
});

// Staged, the index a commit hook is given is the one read: `git commit <path>` stages into a
// temporary index that GIT_INDEX_FILE names, and that index is what the commit will contain.
Deno.test("size ratchet: staged, it reads the index GIT_INDEX_FILE names", async () => {
  const repo = await grown();
  const next = join(repo.root, ".git", "next-index");
  await Deno.copyFile(join(repo.root, ".git", "index"), next);
  const env = { ...IDENTITY, GIT_INDEX_FILE: next };
  const add = await run("git", ["add", "big.ts"], repo.root, env);
  assertEquals(add.code, 0, add.stderr);
  const r = await bashScript(SCRIPT, [], repo.root, { GIT_INDEX_FILE: next });
  assertEquals(r.code, 1, r.stdout + r.stderr);
  assertStringIncludes(r.stderr, "big.ts: 12 → 40");
});
