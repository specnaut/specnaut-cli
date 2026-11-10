// cli#749 — in JSON mode an entry script's stdout is the JSON object and nothing
// else, in both twins, so a caller can parse it whole. Under `pwsh -File`,
// `Write-Warning` lands on stdout with ANSI codes: a project with no git put
// "WARNING: [specify] Warning: Git repository not detected" ahead of the
// object. `setup-plan` printed its status line there too, in both twins.
//
// The notices still reach the user, on stderr, as the same line from each twin.
// Each row parses the WHOLE stdout, never its last line.

import { assertEquals } from "@std/assert";
import { copy } from "@std/fs";
import { fromFileUrl, join } from "@std/path";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import { git, type Run, run } from "./git_sandbox.ts";
import { guardPowerShellArm, PWSH_AVAILABLE } from "./pwsh_arm.ts";

const SCRIPTS = fromFileUrl(new URL("../../templates/core/specnaut/scripts/", import.meta.url));
const BASH = Deno.build.os === "darwin" ? "/bin/bash" : "bash";

guardPowerShellArm();

/** Flags as the scenarios spell them, mapped to each twin's own. */
type Flag = "--timestamp" | "--number" | "--short-name";
const PWSH_FLAG: Record<Flag, string> = {
  "--timestamp": "-Timestamp",
  "--number": "-Number",
  "--short-name": "-ShortName",
};

const TWINS = [
  {
    name: "bash",
    run: (dir: string, script: string, args: string[]) =>
      run(
        BASH,
        [bashPath(join(dir, ".specnaut/scripts/bash", `${script}.sh`)), "--json", ...args],
        dir,
      ),
  },
  ...(PWSH_AVAILABLE
    ? [{
      name: "pwsh",
      run: (dir: string, script: string, args: string[]) =>
        run("pwsh", [
          "-NoProfile",
          "-File",
          join(dir, ".specnaut/scripts/powershell", `${script}.ps1`),
          "-Json",
          ...args.map((a) => PWSH_FLAG[a as Flag] ?? a),
        ], dir),
    }]
    : []),
];

const VALIDATION_SKIPPED =
  "[specify] Warning: Git repository not detected; skipped branch validation";
const LONG = "word".repeat(70);

type Fixture = "no git" | "no git, a plan" | "a feature branch" | "a feature branch, a plan";

const ROWS: Array<
  { label: string; fixture: Fixture; script: string; args: string[]; notice?: string }
> = [
  {
    label: "create-new-feature with no git",
    fixture: "no git",
    script: "create-new-feature",
    args: ["--short-name", "demo", "Demo"],
    notice: "[specify] Warning: Git repository not detected; skipped branch creation for 002-demo",
  },
  {
    label: "create-new-feature with no git, a timestamp and a number",
    fixture: "no git",
    script: "create-new-feature",
    args: ["--timestamp", "--number", "5", "--short-name", "demo", "Demo"],
  },
  {
    label: "create-new-feature with no git and a short name that is truncated",
    fixture: "no git",
    script: "create-new-feature",
    args: ["--short-name", LONG, "Demo"],
  },
  {
    label: "setup-plan with no git and no plan yet",
    fixture: "no git",
    script: "setup-plan",
    args: [],
    notice: VALIDATION_SKIPPED,
  },
  {
    label: "setup-plan with no git and a plan already there",
    fixture: "no git, a plan",
    script: "setup-plan",
    args: [],
    notice: VALIDATION_SKIPPED,
  },
  {
    label: "setup-plan on a feature branch with no plan yet",
    fixture: "a feature branch",
    script: "setup-plan",
    args: [],
  },
  {
    label: "setup-plan on a feature branch with a plan already there",
    fixture: "a feature branch, a plan",
    script: "setup-plan",
    args: [],
  },
  {
    label: "check-prerequisites with no git",
    fixture: "no git, a plan",
    script: "check-prerequisites",
    args: [],
    notice: VALIDATION_SKIPPED,
  },
];

/** A project with both twins installed, a plan template, and the fixture's git and plan. */
async function withProject(fixture: Fixture, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.realPath(await Deno.makeTempDir({ prefix: "json-stdout-twins-" }));
  try {
    await copy(SCRIPTS, join(dir, ".specnaut/scripts"));
    await Deno.mkdir(join(dir, ".specnaut/templates"), { recursive: true });
    await Deno.writeTextFile(join(dir, ".specnaut/templates/plan-template.md"), "# Plan\n");
    const feature = join(dir, ".specnaut/specs/001-demo");
    await Deno.mkdir(feature, { recursive: true });
    if (fixture.endsWith("a plan")) await Deno.writeTextFile(join(feature, "plan.md"), "# Mine\n");
    if (fixture.startsWith("a feature branch")) {
      await git(dir, "init", "-q", "-b", "001-demo");
      await git(dir, "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "x");
    }
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

for (const twin of TWINS) {
  for (const row of ROWS) {
    Deno.test(`json stdout [${twin.name}]: ${row.label}, stdout parses whole`, () =>
      withProject(row.fixture, async (dir) => {
        const r: Run = await twin.run(dir, row.script, row.args);
        assertEquals(r.code, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
        let parsed: unknown;
        try {
          parsed = JSON.parse(r.stdout);
        } catch {
          throw new Error(`stdout is not JSON alone:\n${JSON.stringify(r.stdout)}`);
        }
        assertEquals(typeof parsed, "object");
        if (row.notice) {
          const lines = r.stderr.split(/\r?\n/);
          assertEquals(lines.filter((l) => l === row.notice).length, 1, r.stderr);
        }
      }));
  }
}
