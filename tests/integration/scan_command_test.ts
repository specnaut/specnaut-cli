import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { sizeLimitsYaml } from "../../src/domain/size_limits.ts";
import { dispositions, git, lines, POSIX, repo, scan, scanJson, write } from "./scan_fixture.ts";

/** `specnaut scan` end to end: dispositions, exit codes, and the refusals (FR-002, FR-007). */

const NUL_TEXT = new Uint8Array([0x61, 0x00, 0x0a, 0x62, 0x0a]);

/** One tracked path for every disposition and reason; `gone.ts` is deleted from the disk after. */
const EVERY_DISPOSITION = {
  "src/a.ts": "export function a() {\n  return 1;\n}\n",
  "run.sh": lines(3),
  "LICENSE": lines(4),
  "README.md": lines(2),
  ".specnaut/x.sh": lines(900),
  ".specnaut/installed.lock": "",
  ".claude/agents/dev.md": lines(900),
  "deno.lock": lines(900),
  "img.bin": NUL_TEXT,
  "forced.txt": NUL_TEXT,
  "data.csv": lines(900),
  ".gitattributes": "forced.txt diff\ndata.csv -diff\n",
  ".specnaut/size-limits.yml": 'exempt:\n  - "*.lock"\n',
  "gone.ts": lines(1),
};

async function everyDispositionRepo(): Promise<string> {
  const dir = await repo(EVERY_DISPOSITION);
  await Deno.writeTextFile(
    join(dir, ".specnaut/installed.lock"),
    lockWith(".claude/agents/dev.md"),
  );
  await Deno.remove(join(dir, "gone.ts"));
  return dir;
}

Deno.test("every tracked path ends in one disposition, each counted by its reason", async () => {
  const { result, json } = await scanJson(await everyDispositionRepo());
  assertEquals(result.code, 0, result.stderr);
  const t = json.totals;
  assertEquals(dispositions(json), { tracked: 14, sum: 14 });
  assertEquals(t.exempt_by, { specnaut: 3, installed_lock: 1, exempt_glob: 1, binary: 2 });
  assertEquals(t.missing, 1);
  // `diff` set: text whatever its bytes, so its NUL does not make it binary.
  assertEquals(t.measured, 6);
  assertEquals(
    t.measured,
    t.analysed + Object.values(t.not_analysed).reduce((a: number, b) => a + (b as number), 0),
  );
  const notAnalysed = { code_not_read: 3, no_units_expected: 2, too_large: 0, line_too_long: 0 };
  assertEquals(t.not_analysed, notAnalysed);
  assertEquals(t.units.functions, 1);
});

/** A v2 lock listing `path`, as `specnaut init` writes one. */
function lockWith(path: string): string {
  return "version: 2\nharness: claude\ntemplates_version: 0.0.1\nentries:\n" +
    `  ${path}:\n    sha256: x\n    installed_at: '2026-01-01T00:00:00.000Z'\n    templates_version: 0.0.1\n`;
}

Deno.test("exit 1 for a file over its ceiling; an estimated function over its ceiling is still 0", async () => {
  const body = "  x();\n".repeat(60);
  const dir = await repo({ "a.ts": `function long() {\n${body}}\n` });
  const ok = await scanJson(dir);
  assertEquals(ok.result.code, 0, ok.result.stderr);
  assertEquals(ok.json.functions.items[0].level, "over_ceiling");
  await write(dir, { "big.md": lines(501) });
  await git(dir, "add", "big.md");
  const over = await scanJson(dir);
  assertEquals(over.result.code, 1);
  assertEquals(over.json.files.items[0].path, "big.md");
});

Deno.test("the constitution is held to its own unit, whatever an exempt glob says", async () => {
  const dir = await repo({
    "docs/constitution.md": lines(101),
    ".specnaut/size-limits.yml": 'exempt:\n  - "docs/*"\n',
  });
  const { result, json } = await scanJson(dir);
  assertEquals(result.code, 1);
  assertEquals(json.files.items[0].unit, "constitution");
  assertEquals(json.files.items[0].limit, 100);
});

Deno.test("from a subdirectory: the same limits and the same paths as from the root", async () => {
  const dir = await repo({
    "deep/er/a.ts": lines(300),
    ".specnaut/size-limits.yml": "file:\n  target: 250\n  ceiling: none\n",
  });
  const [root, sub] = [
    await scan(dir, "--format", "json"),
    await scan(join(dir, "deep/er"), "--format", "json"),
  ];
  assertEquals(sub.stdout, root.stdout);
  assertStringIncludes(root.stdout, '"path":"deep/er/a.ts"');
});

Deno.test("--path scopes the listing, and a --path matching nothing is exit 2, never 0 files", async () => {
  const dir = await repo({ "src/a.ts": lines(1), "lib/b.ts": lines(1) });
  const scoped = await scanJson(dir, "--path", "src");
  assertEquals([scoped.json.path, scoped.json.totals.tracked], ["src", 1]);
  const none = await scan(dir, "--path", "nowhere");
  assertEquals(none.code, 2);
  assertStringIncludes(none.stderr, "matches no tracked file");
  // A glob is a literal name here, never a pattern git expands.
  assertEquals((await scan(dir, "--path", "s*")).code, 2);
});

Deno.test("an empty repository is a map of nothing, exit 0", async () => {
  const { result, json } = await scanJson(await repo({}));
  assertEquals([result.code, json.totals.tracked], [0, 0]);
});

Deno.test("no map, exit 3: outside a work tree, an unreadable config, an unreadable lock", async () => {
  const outside = await Deno.makeTempDir({ prefix: "scan-nogit-" });
  const notGit = await scan(outside);
  assertEquals(notGit.code, 3);
  assertStringIncludes(notGit.stderr, "specnaut scan could not run: git rev-parse failed");
  const config = await repo({ ".specnaut/size-limits.yml": "file: {target: 1}\n" });
  const bad = await scan(config);
  assertEquals(bad.code, 3);
  assertStringIncludes(bad.stderr, "size-limits.yml is unreadable");
  const lock = await scan(await repo({ ".specnaut/installed.lock": "version: [\n" }));
  assertEquals(lock.code, 3);
  assertStringIncludes(lock.stderr, "installed.lock is unreadable");
  const removed = await repo({
    ".specnaut/installed.lock": lockWith("a.md").replace("claude", "windsurf"),
  });
  const r = await scan(removed);
  assertEquals(r.code, 3, "exit 1 must mean only a file over its ceiling");
  assertStringIncludes(r.stderr, "installed.lock is unreadable");
});

Deno.test("a file over the read cap is counted by streaming and never handed to the estimator", async () => {
  const dir = await repo({ "big.ts": "x\n".repeat(600 * 1024) });
  const { json } = await scanJson(dir);
  assertEquals(json.totals.lines, 600 * 1024);
  assertEquals(json.totals.not_analysed.too_large, 1);
});

Deno.test({
  name: "a work tree whose core.worktree points elsewhere is refused: .git is not under it",
  ignore: !POSIX,
  fn: async () => {
    const dir = await repo({ "a.ts": lines(1) });
    const elsewhere = await Deno.makeTempDir({ prefix: "scan-elsewhere-" });
    await git(dir, "config", "core.worktree", elsewhere);
    const r = await scan(dir);
    assertEquals(r.code, 3);
    assertStringIncludes(r.stderr, "no .git directly under the work tree's top level");
  },
});

Deno.test("exempt globs over their combined length are refused, exit 3, never trimmed", async () => {
  const globs = Array.from({ length: 9 }, (_, i) => `${i}${"x".repeat(249)}*`);
  const dir = await repo({ ".specnaut/size-limits.yml": sizeLimitsYaml({}, globs) });
  const r = await scan(dir);
  assertEquals(r.code, 3, r.stderr);
  assertStringIncludes(r.stderr, "exempt globs total over 2048 characters");
});

Deno.test("a diff attribute that is not UTF-8 leaves the file to the sniff, never fails the scan", async () => {
  const latin1 = new Uint8Array([...new TextEncoder().encode("a.ts diff=caf"), 0xe9, 0x0a]);
  const dir = await repo({ ".gitattributes": latin1, "a.ts": lines(3), "b.bin": NUL_TEXT });
  const { result, json } = await scanJson(dir);
  assertEquals(result.code, 0, result.stderr);
  assertEquals([json.totals.measured, json.totals.exempt_by.binary], [2, 1]);
});

Deno.test("a file over the read cap that starts with a NUL is binary: no line of it counted", async () => {
  const big = new Uint8Array(1024 * 1024 + 4096).fill(0x0a);
  big[0] = 0;
  const { result, json } = await scanJson(await repo({ "big.dat": big }));
  assertEquals(result.code, 0, result.stderr);
  assertEquals([json.totals.exempt_by.binary, json.totals.measured, json.totals.lines], [1, 0, 0]);
});
