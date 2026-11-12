// `collect-audit-scope.sh --head <sha> [--objects <dir>]` puts that commit in HEAD's place, read
// from git's objects only. The head lives in a separate objects folder, and the project's HEAD
// changed another file, so the scope can only list the head's files by reading the head.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { headRepo } from "../scripts/explicit_head_fixture.ts";
import { scope } from "./collect_audit_scope_fixture.ts";

const fixture = () =>
  headRepo({ "src/a.ts": "a\n" }, { "src/Head.tsx": "h\n" }, { "src/main_only.ts": "m\n" });

/** The lines of the block between `<from>:` and the next label. */
function section(block: string, from: string, to: string): string[] {
  const body = block.split(`${from}:\n`)[1]?.split(`${to}`)[0] ?? "";
  return body.split("\n").filter(Boolean);
}

Deno.test("audit scope --head: the last-N window ends at the head, not at HEAD", async () => {
  const repo = await fixture();
  const r = await scope(repo.root, ["--last", "1", "--head", repo.head, "--objects", repo.objects]);
  assertEquals(r.code, 0, r.stderr);
  assertStringIncludes(r.stdout, "SCOPE: last-N\n");
  assertEquals(section(r.stdout, "FILES", "TOTAL_FILES"), ["src/Head.tsx"]);
  assertEquals(section(r.stdout, "COMMITS", "FILES").map((l) => l.slice(l.indexOf(" ") + 1)), [
    "the head's change",
  ]);
  assertStringIncludes(r.stdout, "FRONTEND_COUNT: 1\n");
});

Deno.test("audit scope --head: --path lists the head's tree", async () => {
  const repo = await fixture();
  const r = await scope(repo.root, [
    "--path",
    "src",
    "--head",
    repo.head,
    "--objects",
    repo.objects,
  ]);
  assertEquals(r.code, 0, r.stderr);
  assertEquals(section(r.stdout, "FILES", "TOTAL_FILES"), ["src/Head.tsx", "src/a.ts"]);
});

Deno.test("audit scope --head: a range naming HEAD is refused", async () => {
  const repo = await fixture();
  const r = await scope(repo.root, [
    "--head",
    repo.head,
    "--objects",
    repo.objects,
    "--range",
    "main..HEAD",
  ]);
  assertEquals(r.code, 2, r.stdout);
  assertStringIncludes(r.stderr, "git-read: refused: ");
  assert(!r.stdout.includes("CODE-AUDIT SCOPE"), r.stdout);
});

Deno.test("audit scope --head: a head out of reach, or objects alone, is refused", async () => {
  const repo = await fixture();
  const cases: [string[], string][] = [
    [["--head", repo.head], `error: --head: no commit ${repo.head} in reach`],
    [["--objects", repo.objects], "error: --head: --objects needs --head"],
  ];
  for (const [args, why] of cases) {
    const r = await scope(repo.root, args);
    assertEquals(r.code, 2, args.join(" ") + r.stdout);
    assertStringIncludes(r.stderr, why);
  }
});
