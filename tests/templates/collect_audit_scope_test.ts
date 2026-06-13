import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

/**
 * Hermetic behaviour test for `collect-audit-scope.sh` (the scope resolver the
 * `/code-audit` skill runs first). Each case spins up a throwaway git repo in a
 * temp dir, commits fixtures, runs the script, and asserts the CODE-AUDIT SCOPE
 * block shape + the CATEGORY SIGNALS integer counts. No network, no shared
 * state — the script must run unmodified in any scaffolded project.
 *
 * Contract: contracts/scope-signals.md. The script lives under the skill's own
 * `scripts/` dir (source); it ships to `.specflow/scripts/code-audit/` in a
 * scaffolded project, but the test exercises the source copy directly.
 */

const SCRIPT = fromFileUrl(
  new URL(
    "../../templates/core/skills/code-audit/scripts/collect-audit-scope.sh",
    import.meta.url,
  ),
);

/** Runs a command in `cwd`, returning {code, stdout, stderr}. */
async function run(
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const out = await new Deno.Command(cmd, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
    env: { ...env },
  }).output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

/** git with deterministic identity + no global config bleed-through. */
async function git(args: string[], cwd: string): Promise<void> {
  const r = await run("git", args, cwd, {
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
    HOME: cwd,
  });
  if (r.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
}

/** Builds a temp git repo with a frontend file, a backend file, and a deno.json. */
async function fixtureRepo(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "code-audit-scope-" });
  await git(["init", "-b", "main"], dir);
  await Deno.mkdir(`${dir}/src`, { recursive: true });
  await Deno.writeTextFile(`${dir}/src/Button.tsx`, "export const Button = () => null;\n");
  await Deno.writeTextFile(`${dir}/src/service.ts`, "export const svc = () => 1;\n");
  await Deno.writeTextFile(`${dir}/deno.json`, "{}\n");
  await git(["add", "."], dir);
  await git(["commit", "-m", "feat: initial fixtures"], dir);
  return dir;
}

async function scope(
  dir: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await run("bash", [SCRIPT, ...args], dir, { HOME: dir });
}

/** Parses an `KEY: value` integer count line from the block. */
function count(block: string, key: string): number {
  const m = block.match(new RegExp(`^${key}: (\\d+)$`, "m"));
  assert(m, `expected a "${key}: <int>" line in:\n${block}`);
  return Number(m[1]);
}

Deno.test("collect-audit-scope --last clamps N to available history (last-N label)", async () => {
  const dir = await fixtureRepo();
  try {
    // The fixture has exactly 1 commit; --last 5 must clamp to "last 1 commits".
    const r = await scope(dir, ["--last", "5"]);
    assertEquals(r.code, 0, r.stderr);
    const out = r.stdout;
    // Block header + the canonical lines, in order.
    assertStringIncludes(out, "CODE-AUDIT SCOPE");
    assertStringIncludes(out, "SCOPE: last-N");
    assertStringIncludes(out, "SCOPE_LABEL: last 1 commits");
    assertStringIncludes(out, "COMMITS:");
    assertStringIncludes(out, "FILES:");
    assertStringIncludes(out, "CATEGORY SIGNALS");
    // Fixture has exactly 3 tracked files: Button.tsx (frontend), service.ts, deno.json (dep).
    assertEquals(count(out, "FRONTEND_COUNT"), 1);
    assertEquals(count(out, "DEP_COUNT"), 1);
    assertEquals(count(out, "TOTAL_FILES"), 3);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("collect-audit-scope --last 2 (non-clamped) covers HEAD~N..HEAD path", async () => {
  const dir = await fixtureRepo();
  try {
    // Add two more commits so the window HEAD~2..HEAD is fully in range
    // (3 commits total > N=2 → no clamp, takes the HEAD~N..HEAD branch).
    await Deno.writeTextFile(`${dir}/src/two.ts`, "export const two = 2;\n");
    await git(["add", "."], dir);
    await git(["commit", "-m", "feat: two"], dir);
    await Deno.writeTextFile(`${dir}/src/three.ts`, "export const three = 3;\n");
    await git(["add", "."], dir);
    await git(["commit", "-m", "feat: three"], dir);
    const r = await scope(dir, ["--last", "2"]);
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "SCOPE: last-N");
    // 3 commits available, N=2 → NOT clamped, label stays "last 2 commits".
    assertStringIncludes(r.stdout, "SCOPE_LABEL: last 2 commits");
    // The last two commits touched two.ts + three.ts only.
    assertEquals(count(r.stdout, "TOTAL_FILES"), 2);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("collect-audit-scope --path scopes to a subtree with the path label", async () => {
  const dir = await fixtureRepo();
  try {
    const r = await scope(dir, ["--path", "src"]);
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "SCOPE: path");
    assertStringIncludes(r.stdout, "src");
    // src/ holds the two .ts(x) files; deno.json is outside it.
    assertEquals(count(r.stdout, "FRONTEND_COUNT"), 1);
    assertEquals(count(r.stdout, "DEP_COUNT"), 0);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("collect-audit-scope emits TOTAL_FILES: 0 distinctly on an empty scope", async () => {
  const dir = await fixtureRepo();
  try {
    // A path that matches nothing tracked.
    const r = await scope(dir, ["--path", "nonexistent-subtree"]);
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "TOTAL_FILES: 0");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("collect-audit-scope counts test files via TEST_COUNT", async () => {
  const dir = await fixtureRepo();
  try {
    await Deno.writeTextFile(`${dir}/src/button_test.ts`, "Deno.test('x', () => {});\n");
    await git(["add", "."], dir);
    await git(["commit", "-m", "test: add a test"], dir);
    const r = await scope(dir, ["--last", "5"]);
    assertEquals(r.code, 0, r.stderr);
    assert(count(r.stdout, "TEST_COUNT") >= 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("collect-audit-scope exits non-zero with a clear error outside a git repo", async () => {
  const dir = await Deno.makeTempDir({ prefix: "code-audit-nogit-" });
  try {
    const r = await scope(dir, ["--last", "5"]);
    assert(r.code !== 0, "expected non-zero exit outside a git repo");
    assertStringIncludes(r.stderr + r.stdout, "requires a git repository");
    // No block leaks to stdout on the guard path.
    assert(!r.stdout.includes("CODE-AUDIT SCOPE"), "no block on the non-repo guard path");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("collect-audit-scope --range scopes to an explicit commit range", async () => {
  const dir = await fixtureRepo();
  try {
    // Second commit adds a file; the range HEAD~1..HEAD covers only it.
    await Deno.writeTextFile(`${dir}/src/added.ts`, "export const added = 1;\n");
    await git(["add", "."], dir);
    await git(["commit", "-m", "feat: added"], dir);
    const r = await scope(dir, ["--range", "HEAD~1..HEAD"]);
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "SCOPE: range");
    assertStringIncludes(r.stdout, "SCOPE_LABEL: HEAD~1..HEAD");
    // Only added.ts changed in that range.
    assertEquals(count(r.stdout, "TOTAL_FILES"), 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("collect-audit-scope resolves unpushed scope vs origin/main", async () => {
  const dir = await fixtureRepo();
  try {
    // Simulate a pushed remote by creating a local bare "origin" and pushing
    // main, then committing two more local (unpushed) commits.
    const originDir = await Deno.makeTempDir({ prefix: "code-audit-origin-" });
    try {
      await git(["init", "--bare", "-b", "main"], originDir);
      await git(["remote", "add", "origin", originDir], dir);
      await git(["push", "origin", "main"], dir);
      await Deno.writeTextFile(`${dir}/src/local.ts`, "export const local = 1;\n");
      await git(["add", "."], dir);
      await git(["commit", "-m", "feat: local unpushed"], dir);
      const r = await scope(dir, []);
      assertEquals(r.code, 0, r.stderr);
      assertStringIncludes(r.stdout, "SCOPE: unpushed");
      assertStringIncludes(r.stdout, "SCOPE_LABEL: origin/main..HEAD (1 commits)");
      // Only the unpushed commit's file is in scope.
      assertEquals(count(r.stdout, "TOTAL_FILES"), 1);
    } finally {
      await Deno.remove(originDir, { recursive: true });
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("collect-audit-scope falls back to since-tag when nothing is unpushed", async () => {
  const dir = await fixtureRepo();
  try {
    // No origin/main → unpushed rule can't fire. Tag the first commit, then
    // commit once more; the since-tag rule resolves <tag>..HEAD.
    await git(["tag", "v0.0.1"], dir);
    await Deno.writeTextFile(`${dir}/src/post-tag.ts`, "export const postTag = 1;\n");
    await git(["add", "."], dir);
    await git(["commit", "-m", "feat: post tag"], dir);
    const r = await scope(dir, []);
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "SCOPE: since-tag");
    assertStringIncludes(r.stdout, "SCOPE_LABEL: v0.0.1..HEAD");
    // Only the post-tag commit's file is in scope.
    assertEquals(count(r.stdout, "TOTAL_FILES"), 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("collect-audit-scope counts infra files via INFRA_COUNT", async () => {
  const dir = await fixtureRepo();
  try {
    await Deno.writeTextFile(`${dir}/Dockerfile`, "FROM scratch\n");
    await git(["add", "."], dir);
    await git(["commit", "-m", "chore: add Dockerfile"], dir);
    const r = await scope(dir, ["--last", "5"]);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(count(r.stdout, "INFRA_COUNT"), 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("collect-audit-scope warns and emits empty scope when --path matches nothing", async () => {
  const dir = await fixtureRepo();
  try {
    const r = await scope(dir, ["--path", "nonexistent-subtree"]);
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "TOTAL_FILES: 0");
    assertStringIncludes(r.stderr, "matched no tracked files");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("collect-audit-scope rejects a non-integer --last with exit 2", async () => {
  const dir = await fixtureRepo();
  try {
    const r = await scope(dir, ["--last", "abc"]);
    assertEquals(r.code, 2);
    assertStringIncludes(r.stderr, "positive integer");
    assert(!r.stdout.includes("CODE-AUDIT SCOPE"), "no block on the validation-error path");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("collect-audit-scope rejects --last 0 with exit 2", async () => {
  const dir = await fixtureRepo();
  try {
    const r = await scope(dir, ["--last", "0"]);
    assertEquals(r.code, 2);
    assertStringIncludes(r.stderr, "positive integer");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("collect-audit-scope rejects a malformed --range with exit 2", async () => {
  const dir = await fixtureRepo();
  try {
    const r = await scope(dir, ["--range", "not-a-range"]);
    assertEquals(r.code, 2);
    assertStringIncludes(r.stderr, "<a>..<b>");
    assert(!r.stdout.includes("CODE-AUDIT SCOPE"), "no block on the validation-error path");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
