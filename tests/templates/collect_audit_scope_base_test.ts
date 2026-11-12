// `collect-audit-scope.sh --base <sha> --head <sha> [--objects <dir>]` scopes a branch against
// the tip of the branch it targets, without reading HEAD. The checkout here is left at the fork
// point, behind the base's tip, as a review's checkout may be; and the base changes a file after
// the fork, so a scope taken from HEAD, or a two-point diff from the base's tip, names commits or
// files that are not the branch's.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { git, headRepo } from "../scripts/explicit_head_fixture.ts";
import { scope, section } from "./collect_audit_scope_fixture.ts";

/** `shared.ts` at the fork; the head adds `feature.ts`; the base then edits `shared.ts`. */
async function forked() {
  const repo = await headRepo(
    { "src/shared.ts": "shared\n" },
    { "src/feature.ts": "f\n" },
    { "src/shared.ts": "shared, edited on the base\n" },
  );
  const tip = await git(repo.root, "rev-parse", "main");
  await git(repo.root, "checkout", "-q", "--detach", repo.base);
  return { ...repo, tip };
}

const subjects = (block: string) =>
  section(block, "COMMITS", "FILES").map((l) => l.slice(l.indexOf(" ") + 1));

Deno.test("audit scope --base: the branch's commits and files, with HEAD behind the base's tip", async () => {
  const repo = await forked();
  const r = await scope(repo.root, [
    "--base",
    repo.tip,
    "--head",
    repo.head,
    "--objects",
    repo.objects,
  ]);
  assertEquals(r.code, 0, r.stderr);
  assertStringIncludes(r.stdout, "SCOPE: range\n");
  assertStringIncludes(r.stdout, `SCOPE_LABEL: ${repo.tip}..${repo.head}\n`);
  assertEquals(subjects(r.stdout), ["the head's change"]);
  assertEquals(section(r.stdout, "FILES", "TOTAL_FILES"), ["src/feature.ts"]);
  assertStringIncludes(r.stdout, "TOTAL_FILES: 1\n");
});

Deno.test("audit scope --base: a file only the base changed since the fork is not in scope", async () => {
  const repo = await forked();
  const r = await scope(repo.root, [
    "--base",
    repo.tip,
    "--head",
    repo.head,
    "--objects",
    repo.objects,
  ]);
  assertEquals(r.code, 0, r.stderr);
  const files = section(r.stdout, "FILES", "TOTAL_FILES");
  assert(!files.includes("src/shared.ts"), files.join(", "));
});

Deno.test("audit scope --base: needs a head, mixes with no other scope, and takes a full id", async () => {
  const repo = await forked();
  const head = ["--head", repo.head, "--objects", repo.objects];
  const cases: [string[], string][] = [
    [["--base", repo.tip], "error: --base needs --head"],
    [["--base", repo.tip, ...head, "--path", "src"], "error: --base takes no --path"],
    [["--base", repo.tip, ...head, "--range", "main..main"], "error: --base takes no --path"],
    [["--base", repo.tip, ...head, "--last", "3"], "error: --base takes no --path"],
    [["--base", "main", ...head], "error: --base takes a full commit id (got: main)"],
    [["--base", repo.tip.slice(0, 12), ...head], "error: --base takes a full commit id"],
    [["--base", repo.tip.toUpperCase(), ...head], "error: --base takes a full commit id"],
    [["--base", "", ...head], "error: --base takes a full commit id (got: <empty>)"],
    [["--base", "0".repeat(40), ...head], `error: --base: no commit ${"0".repeat(40)} in reach`],
  ];
  for (const [args, why] of cases) {
    const r = await scope(repo.root, args);
    assertEquals(r.code, 2, args.join(" ") + r.stdout);
    assertStringIncludes(r.stderr, why, args.join(" "));
    assert(!r.stdout.includes("CODE-AUDIT SCOPE"), r.stdout);
  }
});

// The base is the side the review trusts: its id is proved against the repository's own objects,
// never through the objects folder the head came in.

Deno.test("audit scope --base: a base present only in the objects folder is refused", async () => {
  const repo = await forked();
  const exported = repo.objects.replace(/[\\/]objects$/, "");
  const tree = await git(repo.root, "rev-parse", "main^{tree}");
  const only = await git(
    repo.root,
    "--git-dir",
    exported,
    "commit-tree",
    "-p",
    repo.head,
    "-m",
    "x",
    tree,
  );
  const head = ["--head", repo.head, "--objects", repo.objects];
  const r = await scope(repo.root, ["--base", only, ...head]);
  assertEquals(r.code, 2, r.stdout);
  assertStringIncludes(r.stderr, `error: --base: no commit ${only} in reach`);
});

Deno.test("audit scope --base: with an empty objects folder, a base in the repository resolves", async () => {
  const repo = await forked();
  const empty = (await Deno.makeTempDir({ prefix: "audit-empty-objects-" })).replaceAll("\\", "/");
  const r = await scope(repo.root, ["--base", repo.base, "--head", repo.tip, "--objects", empty]);
  assertEquals(r.code, 0, r.stderr);
  assertEquals(section(r.stdout, "FILES", "TOTAL_FILES"), ["src/shared.ts"]);
});
