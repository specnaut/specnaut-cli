// `boundary-check.sh --head <sha> [--objects <dir>]` checks that commit's tree, each file read as
// its blob by id from git's objects. The project's work tree and HEAD hold a different violation
// from the head's, so the file a report names says which one was read.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { BOUNDARIES_CONFIG_PATH } from "../../src/domain/constitution_paths.ts";
import { bashScript, headRepo } from "./explicit_head_fixture.ts";

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

Deno.test("boundary check --head: a head the repository cannot reach is refused, never discovered", async () => {
  const repo = await split();
  const r = await check(repo.root, ["--head", repo.head]);
  assertEquals(r.code, 2, r.stdout + r.stderr);
  assertStringIncludes(r.stderr, `boundary-check: --head: no commit ${repo.head} in reach`);
});

Deno.test("boundary check: --objects needs --head, and any other argument is refused", async () => {
  const repo = await split();
  for (const args of [["--objects", repo.objects], ["--since", repo.base]]) {
    const r = await check(repo.root, args);
    assertEquals(r.code, 2, args.join(" ") + r.stderr);
    assertStringIncludes(r.stderr, "usage: boundary-check.sh [--head <sha> [--objects <dir>]]");
  }
});
