// `size-ratchet.sh --since <ref> --head <sha> [--objects <dir>]` measures that commit, read from
// git's objects only: the head lives in a separate objects folder, and the project's HEAD, index
// and work tree hold other sizes, so the numbers asserted can come from nowhere else.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { SIZE_LIMITS_CONFIG_PATH } from "../../src/domain/constitution_paths.ts";
import { bashScript, headRepo } from "./explicit_head_fixture.ts";
import { FILE, lines, SCRIPT } from "./size_ratchet_fixture.ts";

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
  for (
    const args of [
      ["--head", repo.head, "--objects", repo.objects],
      ["--since", repo.base, "--objects", repo.objects],
    ]
  ) {
    const r = await ratchet(repo.root, args);
    assertEquals(r.code, 3, args.join(" ") + r.stderr);
    assertStringIncludes(r.stderr, "usage: size-ratchet.sh");
  }
});
