// cli#719 — a PowerShell probe that failed says so on stderr, and a normal answer
// says nothing. Each row of the plan's warning rule is one test here, dot-sourcing
// common.ps1 where a real project has it and calling the functions: whole-script
// quiet is not asserted, because `Write-Warning` elsewhere in those scripts lands
// on stdout and is another finding.
//
// Every quiet assertion is paired with the values the functions returned, so it
// cannot be satisfied by a run that never reached them (`RESULT` lines below).

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { copy } from "@std/fs";
import { fromFileUrl, join } from "@std/path";
import { git, type Run, run } from "./git_sandbox.ts";
import { guardPowerShellArm, PWSH_AVAILABLE } from "./pwsh_arm.ts";

const PWSH_DIR = fromFileUrl(
  new URL("../../templates/core/specnaut/scripts/powershell/", import.meta.url),
);

const WINDOWS = Deno.build.os === "windows";

guardPowerShellArm();

/** A project with the scripts installed, so the script-location fallback lands on it. */
async function withProject(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.realPath(await Deno.makeTempDir({ prefix: "ps-warning-rule-" }));
  try {
    await copy(PWSH_DIR, join(dir, ".specnaut/scripts/powershell"));
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Runs each of the three git-backed functions in one process, so "once" is observable. */
const GIT_FUNCTIONS = `
"RESULT root=$(Get-RepoRoot)"
"RESULT branch=$(Get-CurrentBranch)"
"RESULT hasgit=$(Test-HasGit)"
"RESULT gitfound=$([bool](Get-Command git -ErrorAction SilentlyContinue))"
`;

/** `body` in a pwsh with common.ps1 dot-sourced and, when given, `path` as its whole PATH. */
function pwsh(dir: string, body: string, path?: string, preference = ""): Promise<Run> {
  const setPath = path === undefined ? "" : `$env:PATH = '${path}'\n`;
  const script = `${setPath}${preference}. '.specnaut/scripts/powershell/common.ps1'\n${body}`;
  return run("pwsh", ["-NoProfile", "-Command", script], dir);
}

/** Paths in `/` form: on Windows git answers `C:/x` where PowerShell's own path is `C:\\x`. */
const slashes = (p: string) => p.replaceAll("\\", "/");

const results = (r: Run) =>
  r.stdout.split(/\r?\n/).filter((l) => l.startsWith("RESULT ")).map((l) => slashes(l.slice(7)));

const warnings = (r: Run) => r.stderr.split(/\r?\n/).filter((l) => l.startsWith("WARNING:"));

function test(name: string, fn: (dir: string) => Promise<void>, ignore = false): void {
  Deno.test({ name, ignore: ignore || !PWSH_AVAILABLE, fn: () => withProject(fn) });
}

test(".git absent, git present: quiet, and the script's location is the root", async (dir) => {
  const r = await pwsh(dir, GIT_FUNCTIONS);
  assertEquals(results(r), [
    `root=${slashes(dir)}`,
    "branch=main",
    "hasgit=False",
    "gitfound=True",
  ]);
  assertEquals(r.stderr, "");
});

test("git not on PATH, .git absent: quiet", async (dir) => {
  const empty = join(dir, "no-tools");
  await Deno.mkdir(empty);
  const r = await pwsh(dir, GIT_FUNCTIONS, empty);
  assertEquals(results(r), [
    `root=${slashes(dir)}`,
    "branch=main",
    "hasgit=False",
    "gitfound=False",
  ]);
  assertEquals(r.stderr, "");
});

test("an unborn HEAD: quiet, and the branch falls through to the latest feature", async (dir) => {
  await git(dir, "init", "-q", "-b", "trunk");
  await Deno.mkdir(join(dir, ".specnaut/specs/007-export"), { recursive: true });
  const r = await pwsh(dir, GIT_FUNCTIONS);
  assertEquals(results(r), [
    `root=${slashes(dir)}`,
    "branch=007-export",
    "hasgit=True",
    "gitfound=True",
  ]);
  assertEquals(r.stderr, "");
});

// POSIX only: a file that resolves on PATH and cannot start is an executable bit
// over a bad interpreter line. Windows resolves a command by its extension and
// has neither, so the row has no equivalent fixture there.
test("git on PATH that cannot start: warns once, naming the error's type only", async (dir) => {
  const stubs = join(dir, "stubs");
  await Deno.mkdir(stubs);
  await Deno.writeTextFile(join(stubs, "git"), "#!/nonexistent/interpreter\n");
  await Deno.chmod(join(stubs, "git"), 0o755);
  const r = await pwsh(dir, GIT_FUNCTIONS, stubs);
  assertEquals(results(r), [
    `root=${slashes(dir)}`,
    "branch=main",
    "hasgit=False",
    "gitfound=True",
  ]);
  assertEquals(warnings(r).length, 1, r.stderr);
  assertStringIncludes(warnings(r)[0], "git could not be started");
  // The exception's own message names the stub's path; the warning names only its type.
  assert(!r.stderr.includes(stubs), `the exception's text reached the warning: ${r.stderr}`);
}, WINDOWS);

test(".git present, git not on PATH: warns once", async (dir) => {
  const empty = join(dir, "no-tools");
  await Deno.mkdir(empty);
  await Deno.mkdir(join(dir, ".git"));
  const r = await pwsh(dir, GIT_FUNCTIONS, empty);
  assertEquals(results(r), [
    `root=${slashes(dir)}`,
    "branch=main",
    "hasgit=False",
    "gitfound=False",
  ]);
  assertEquals(warnings(r).length, 1, r.stderr);
  assertStringIncludes(warnings(r)[0], "git is not on PATH");
});

test(".git present, git exits non-zero: warns once, with the code and none of git's text", async (dir) => {
  await Deno.writeTextFile(join(dir, ".git"), "gitdir: /nowhere\n");
  const r = await pwsh(dir, GIT_FUNCTIONS);
  assertEquals(results(r), [
    `root=${slashes(dir)}`,
    "branch=main",
    "hasgit=False",
    "gitfound=True",
  ]);
  assertEquals(warnings(r).length, 1, r.stderr);
  assertStringIncludes(warnings(r)[0], "git exited 128");
  assert(!r.stderr.includes("nowhere"), `git's text reached the warning: ${r.stderr}`);
});

test("a repository with a commit answers quietly with its branch", async (dir) => {
  await git(dir, "init", "-q", "-b", "042-import");
  await git(dir, "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "x");
  const r = await pwsh(dir, GIT_FUNCTIONS);
  assertEquals(results(r), [
    `root=${slashes(dir)}`,
    "branch=042-import",
    "hasgit=True",
    "gitfound=True",
  ]);
  assertEquals(r.stderr, "");
});

// `Stop`, and `Stop` with native exits raising: a caller's preference turns git's
// non-zero exit into an exception, which must not read as a git that cannot start.
for (
  const [label, preference] of [
    ["Stop", "$ErrorActionPreference = 'Stop'\n"],
    [
      "Stop and native errors",
      "$ErrorActionPreference = 'Stop'\n$PSNativeCommandUseErrorActionPreference = $true\n",
    ],
  ]
) {
  test(`under ${label}: .git absent, git present is still quiet`, async (dir) => {
    const r = await pwsh(dir, GIT_FUNCTIONS, undefined, preference);
    assertEquals(results(r), [
      `root=${slashes(dir)}`,
      "branch=main",
      "hasgit=False",
      "gitfound=True",
    ]);
    assertEquals(r.stderr, "");
  });

  test(`under ${label}: an unborn HEAD is still quiet`, async (dir) => {
    await git(dir, "init", "-q", "-b", "trunk");
    const r = await pwsh(dir, GIT_FUNCTIONS, undefined, preference);
    assertEquals(results(r), [
      `root=${slashes(dir)}`,
      "branch=main",
      "hasgit=True",
      "gitfound=True",
    ]);
    assertEquals(r.stderr, "");
  });

  test(`under ${label}: git exiting non-zero on a .git still warns of the exit`, async (dir) => {
    await Deno.writeTextFile(join(dir, ".git"), "gitdir: /nowhere\n");
    const r = await pwsh(dir, GIT_FUNCTIONS, undefined, preference);
    assertEquals(results(r), [
      `root=${slashes(dir)}`,
      "branch=main",
      "hasgit=False",
      "gitfound=True",
    ]);
    assertEquals(warnings(r).length, 1, r.stderr);
    assertStringIncludes(warnings(r)[0], "git exited 128");
  });
}

/** A preset the fallback order finds, under a registry holding `registry`. */
async function withRegistry(dir: string, registry: string): Promise<string> {
  const templates = join(dir, ".specnaut/presets/zeta/templates");
  await Deno.mkdir(templates, { recursive: true });
  await Deno.writeTextFile(join(templates, "plan-template.md"), "# Plan\n");
  await Deno.writeTextFile(join(dir, ".specnaut/presets/.registry"), registry);
  return join(templates, "plan-template.md");
}

const RESOLVE_TWICE = `
"RESULT first=$(Resolve-Template -TemplateName 'plan-template' -RepoRoot (Get-Location).Path)"
"RESULT second=$(Resolve-Template -TemplateName 'plan-template' -RepoRoot (Get-Location).Path)"
`;

test("a malformed .registry warns once, in fixed text, and the directory order still answers", async (dir) => {
  // A raw ESC and a marker in a key: what a parser's message would quote, and
  // what would reach a terminal or an agent's context if the warning quoted it.
  const found = await withRegistry(dir, `{"presets": {"MARKER-\u001b[31m": {`);
  const r = await pwsh(dir, RESOLVE_TWICE);
  const paths = results(r);
  assertEquals(paths.length, 2, r.stdout);
  for (const p of paths) assertStringIncludes(p, slashes(found));
  assertEquals(warnings(r).length, 1, r.stderr);
  assertStringIncludes(warnings(r)[0], ".specnaut/presets/.registry could not be parsed");
  assert(!r.stderr.includes("MARKER"), `the key reached the warning: ${r.stderr}`);
  assert(!r.stderr.includes("\u001b"), `an ESC reached the warning: ${JSON.stringify(r.stderr)}`);
});

for (const [label, registry] of [["empty", ""], ["blank", "  \n"]]) {
  test(`a ${label} .registry is quiet, and the directory order answers`, async (dir) => {
    const found = await withRegistry(dir, registry);
    const r = await pwsh(dir, RESOLVE_TWICE);
    const paths = results(r);
    assertEquals(paths.length, 2, r.stdout);
    for (const p of paths) assertStringIncludes(p, slashes(found));
    assertEquals(r.stderr, "");
  });
}

test("a valid .registry still orders the presets by priority, quietly", async (dir) => {
  await withRegistry(dir, JSON.stringify({ presets: { zeta: { priority: 5 }, alpha: {} } }));
  const alpha = join(dir, ".specnaut/presets/alpha/templates");
  await Deno.mkdir(alpha, { recursive: true });
  await Deno.writeTextFile(join(alpha, "plan-template.md"), "# Alpha\n");
  const r = await pwsh(dir, RESOLVE_TWICE);
  // Priority 5 beats the default 10, though the directory order would give `alpha`.
  assertStringIncludes(results(r)[0], "zeta");
  assertEquals(r.stderr, "");
});
