// cli#719 — a PowerShell probe that failed says so on stderr, and a normal answer
// says nothing. The rows both twins owe run against pwsh in the twin tables:
// git_probe_twins_test.ts (the git-backed functions and the entry scripts) and
// template_resolution_twins_test.ts (every `.registry` state). This file keeps
// the rules only PowerShell has (cli#761): a caller's `$ErrorActionPreference`,
// and "once per process" across two template resolutions in one session, where
// the bash twin resolves one template per run.
//
// Every quiet assertion is paired with the values the functions returned, so it
// cannot be satisfied by a run that never reached them (`RESULT` lines below).

import { assertEquals, assertStringIncludes } from "@std/assert";
import { copy } from "@std/fs";
import { join } from "@std/path";
import { git, type Run } from "./git_sandbox.ts";
import { slashes } from "./twin_paths.ts";
import { guardPowerShellArm, PWSH_AVAILABLE } from "./pwsh_arm.ts";
import { results as resultLines, SCRIPTS, twins, warnings } from "./twin_runner.ts";

guardPowerShellArm();

const PWSH = twins(false)[0];

/** A project with the scripts installed, so the script-location fallback lands on it. */
async function withProject(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.realPath(await Deno.makeTempDir({ prefix: "ps-warning-rule-" }));
  try {
    await copy(SCRIPTS, join(dir, ".specnaut/scripts"));
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

/** `body` in a pwsh with common.ps1 dot-sourced after `preference`, as an entry script sets it. */
const pwsh = (dir: string, body: string, preference = ""): Promise<Run> =>
  PWSH.functions(join(dir, ".specnaut/scripts"), { bash: "", pwsh: body }, dir, {
    before: { pwsh: preference },
  });

/** `slashes` on a path value only: it lowercases on Windows, and `False` is PowerShell's. */
const fold = (l: string) => /^(root|first|second)=/.test(l) ? slashes(l) : l;
const results = (r: Run) => resultLines(r).map(fold);

function test(name: string, fn: (dir: string) => Promise<void>): void {
  Deno.test({ name, ignore: !PWSH_AVAILABLE, fn: () => withProject(fn) });
}

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
    const r = await pwsh(dir, GIT_FUNCTIONS, preference);
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
    const r = await pwsh(dir, GIT_FUNCTIONS, preference);
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
    const r = await pwsh(dir, GIT_FUNCTIONS, preference);
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

const RESOLVE_TWICE = `
"RESULT first=$(Resolve-Template -TemplateName 'plan-template' -RepoRoot (Get-Location).Path)"
"RESULT second=$(Resolve-Template -TemplateName 'plan-template' -RepoRoot (Get-Location).Path)"
`;

// The fixed text, and that no key reaches it, are the twin tables'; here, that
// two resolutions in one session warn once.
test("a malformed .registry warns once per process, and the directory order still answers", async (dir) => {
  const templates = join(dir, ".specnaut/presets/zeta/templates");
  await Deno.mkdir(templates, { recursive: true });
  await Deno.writeTextFile(join(templates, "plan-template.md"), "# Plan\n");
  await Deno.writeTextFile(join(dir, ".specnaut/presets/.registry"), "{not json");
  const r = await pwsh(dir, RESOLVE_TWICE);
  const paths = results(r);
  assertEquals(paths.length, 2, r.stdout);
  for (const p of paths) assertStringIncludes(p, slashes(join(templates, "plan-template.md")));
  assertEquals(warnings(r).length, 1, r.stderr);
  assertStringIncludes(warnings(r)[0], ".specnaut/presets/.registry could not be parsed");
});
