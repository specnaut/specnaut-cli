// cli#754 — a git probe that failed says so the same way in both twins: once per
// run, on stderr, in fixed text, and a normal "no" says nothing. The rule is
// `Invoke-GitProbe`'s (cli#719); `_git_probe` is its bash twin.
//
// The function rows call the git-backed functions in one shell, so "once" is
// observable; they are the warning rule's rows for PowerShell too. The entry
// rows run the scripts, where the bash functions are called inside `$( … )`:
// only there is a flag set in a subshell lost, and only there does "once per
// run" have to survive it.
//
// Every quiet assertion is paired with the values the functions returned, so it
// cannot be satisfied by a run that never reached them (`RESULT` lines).

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { copy } from "@std/fs";
import { join } from "@std/path";
import { git, type Run, run } from "./git_sandbox.ts";
import { slashes } from "./twin_paths.ts";
import { guardPowerShellArm } from "./pwsh_arm.ts";
import { BASH, results as resultLines, SCRIPTS, twins, warnings } from "./twin_runner.ts";

const WINDOWS = Deno.build.os === "windows";

guardPowerShellArm();

/** A project with both twins installed, so the installed root is the project. */
async function withProject(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.realPath(await Deno.makeTempDir({ prefix: "git-probe-twins-" }));
  try {
    await copy(SCRIPTS, installed(dir));
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const installed = (dir: string) => join(dir, ".specnaut/scripts");

/**
 * A directory standing in for PATH with no git on it. Bash still needs the
 * tools `common.sh` calls, so each is a wrapper over the real one by its
 * absolute path; PowerShell needs none.
 */
async function pathWithout(dir: string, gitStub?: string): Promise<string> {
  const bin = join(dir, "no-git-bin");
  await Deno.mkdir(bin);
  for (const tool of ["dirname", "basename"]) {
    const real = (await run(BASH, ["-c", `command -v ${tool}`], dir)).stdout.trim();
    await Deno.writeTextFile(join(bin, tool), `#!/bin/sh\nexec '${real}' "$@"\n`);
  }
  if (gitStub !== undefined) await Deno.writeTextFile(join(bin, "git"), gitStub);
  // Windows has no mode bits; the rows that run these there do not execute them.
  if (!WINDOWS) {
    for await (const e of Deno.readDir(bin)) await Deno.chmod(join(bin, e.name), 0o755);
  }
  return bin;
}

/** The three git-backed functions in one shell, each answering on a `RESULT` line. */
const GIT_FUNCTIONS = {
  bash: `printf 'RESULT root=%s\\n' "$(get_repo_root)"
printf 'RESULT branch='; get_current_branch
if has_git; then echo RESULT hasgit=true; else echo RESULT hasgit=false; fi
if command -v git >/dev/null; then echo RESULT gitfound=true; else echo RESULT gitfound=false; fi`,
  pwsh: `"RESULT root=$(Get-RepoRoot)"
"RESULT branch=$(Get-CurrentBranch)"
"RESULT hasgit=$("$(Test-HasGit)".ToLower())"
"RESULT gitfound=$("$([bool](Get-Command git -ErrorAction SilentlyContinue))".ToLower())"`,
};

const results = (r: Run) =>
  resultLines(r).map((l) => l.startsWith("root=") ? `root=${slashes(l.slice(5))}` : l);

const BROKEN = "WARNING: git exited 128 reading this repository; continuing without git";
const NO_GIT = "WARNING: .git is present but git is not on PATH; continuing without git";

/**
 * One row of the warning rule: the fixture, the values both twins return, and
 * the one warning they print, if any. `posixBash` rows replace PATH, which Git
 * Bash on Windows cannot have without git: its tools load DLLs from beside the
 * git it ships with, and the row has no portable fixture there.
 */
const ROWS: Array<{
  label: string;
  setup: (dir: string) => Promise<string | undefined>;
  values: { branch: string; hasgit: boolean; gitfound: boolean };
  warning?: string;
  /** A substring for a warning whose tail differs by twin (an error type, an exit code). */
  warningIncludes?: string;
  posixBash?: boolean;
  posixOnly?: boolean;
}> = [
  {
    label: ".git absent, git present: quiet",
    setup: () => Promise.resolve(undefined),
    values: { branch: "main", hasgit: false, gitfound: true },
  },
  {
    label: "git not on PATH, .git absent: quiet",
    setup: (dir) => pathWithout(dir),
    values: { branch: "main", hasgit: false, gitfound: false },
    posixBash: true,
  },
  {
    label: "an unborn HEAD: quiet, and the branch falls through to the latest feature",
    setup: async (dir) => {
      await git(dir, "init", "-q", "-b", "trunk");
      await Deno.mkdir(join(dir, ".specnaut/specs/007-export"), { recursive: true });
      return undefined;
    },
    values: { branch: "007-export", hasgit: true, gitfound: true },
  },
  {
    // POSIX only: a file that resolves on PATH and cannot start is an executable
    // bit over a bad interpreter line, which Windows has no equivalent of.
    label: "git on PATH that cannot start: warns once, naming no path",
    setup: (dir) => pathWithout(dir, "#!/nonexistent/interpreter\n"),
    values: { branch: "main", hasgit: false, gitfound: true },
    warningIncludes: "WARNING: git could not be started (",
    posixOnly: true,
  },
  {
    label: ".git present, git not on PATH: warns once",
    setup: async (dir) => {
      await Deno.mkdir(join(dir, ".git"));
      return pathWithout(dir);
    },
    values: { branch: "main", hasgit: false, gitfound: false },
    warning: NO_GIT,
    posixBash: true,
  },
  {
    label: "a .git git exits 128 on: warns once, with the code and none of git's text",
    setup: async (dir) => {
      await Deno.writeTextFile(join(dir, ".git"), "gitdir: /nowhere\n");
      return undefined;
    },
    values: { branch: "main", hasgit: false, gitfound: true },
    warning: BROKEN,
  },
  {
    label: "a repository with a commit answers quietly with its branch",
    setup: async (dir) => {
      await git(dir, "init", "-q", "-b", "042-import");
      await git(dir, "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "x");
      return undefined;
    },
    values: { branch: "042-import", hasgit: true, gitfound: true },
  },
];

for (const twin of twins()) {
  for (const row of ROWS) {
    Deno.test({
      name: `git probe [${twin.name}]: ${row.label}`,
      ignore: WINDOWS && (row.posixOnly || (row.posixBash && twin.name === "bash")),
      fn: () =>
        withProject(async (dir) => {
          const path = await row.setup(dir);
          const r = await twin.functions(installed(dir), GIT_FUNCTIONS, dir, path);
          const { branch, hasgit, gitfound } = row.values;
          assertEquals(results(r), [
            `root=${slashes(dir)}`,
            `branch=${branch}`,
            `hasgit=${hasgit}`,
            `gitfound=${gitfound}`,
          ], `stderr: ${r.stderr}`);
          if (row.warning) {
            assertEquals(warnings(r), [row.warning], r.stderr);
          } else if (row.warningIncludes) {
            assertEquals(warnings(r).length, 1, r.stderr);
            assertStringIncludes(warnings(r)[0], row.warningIncludes);
            assert(!r.stderr.includes(path ?? "\0"), `a path reached the warning: ${r.stderr}`);
          } else {
            assertEquals(r.stderr, "");
          }
          assert(!r.stderr.includes("nowhere"), `git's text reached stderr: ${r.stderr}`);
        }),
    });
  }

  // Once per RUN: the entry scripts, in a project whose .git git cannot read.
  const feature = ["create-new-feature", "--dry-run", "demo"];
  for (const [script, ...args] of [["setup-plan"], ["check-prerequisites"], feature]) {
    Deno.test(`git probe [${twin.name}]: ${script} warns once per run`, () =>
      withProject(async (dir) => {
        await Deno.writeTextFile(join(dir, ".git"), "gitdir: /nowhere\n");
        await Deno.mkdir(join(dir, ".specnaut/specs/001-demo"), { recursive: true });
        await Deno.writeTextFile(join(dir, ".specnaut/specs/001-demo/plan.md"), "# Plan\n");
        const r = await twin.entry(installed(dir), script, ["--json", ...args], dir);
        assertEquals(warnings(r), [BROKEN], `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
        assert(!r.stderr.includes("nowhere"), `git's text reached stderr: ${r.stderr}`);
      }));
  }
}
