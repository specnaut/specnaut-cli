// cli#750 — the bash and PowerShell twins resolve the same project root from the
// same place, and that root is the directory holding `.specnaut`.
//
// Installed, a script's root is the project it is installed in, wherever it is
// run from: a `.specnaut` planted above the working directory cannot claim it.
// Run in place (the templates tree, which is no project), the nearest
// `.specnaut` above the working directory wins, then git's top level. Whether
// the root has git is asked of git at that root: a project nested in a parent
// repository keeps the parent's branches.
//
// One scenario list over both twins, so an expected value cannot differ per twin.

import { assert, assertEquals } from "@std/assert";
import { copy } from "@std/fs";
import { fromFileUrl, join } from "@std/path";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import { git, type Run, run } from "./git_sandbox.ts";
import { slashes } from "./twin_paths.ts";
import { guardPowerShellArm, PWSH_AVAILABLE } from "./pwsh_arm.ts";

const SCRIPTS = fromFileUrl(new URL("../../templates/core/specnaut/scripts/", import.meta.url));
const WINDOWS = Deno.build.os === "windows";
const BASH = Deno.build.os === "darwin" ? "/bin/bash" : "bash";

guardPowerShellArm();

/** The directories a twin's scripts are run from. */
type Scripts = { bash: string; powershell: string };

const IN_PLACE: Scripts = { bash: join(SCRIPTS, "bash"), powershell: join(SCRIPTS, "powershell") };

/** Both twins installed where `specnaut init` puts them. */
async function install(project: string): Promise<Scripts> {
  const dest = join(project, ".specnaut/scripts");
  await copy(SCRIPTS, dest);
  return { bash: join(dest, "bash"), powershell: join(dest, "powershell") };
}

const TWINS = [
  {
    name: "bash",
    probe: (s: Scripts, cwd: string) =>
      run(BASH, [
        "-c",
        `source '${bashPath(join(s.bash, "common.sh"))}'
printf 'RESULT root=%s\\n' "$(get_repo_root)"
if has_git; then echo RESULT hasgit=true; else echo RESULT hasgit=false; fi`,
      ], cwd),
    feature: (s: Scripts, cwd: string) =>
      run(BASH, [
        bashPath(join(s.bash, "create-new-feature.sh")),
        "--json",
        "--dry-run",
        "--short-name",
        "demo",
        "Demo",
      ], cwd),
  },
  ...(PWSH_AVAILABLE
    ? [{
      name: "pwsh",
      probe: (s: Scripts, cwd: string) =>
        run("pwsh", [
          "-NoProfile",
          "-Command",
          `. '${join(s.powershell, "common.ps1")}'
"RESULT root=$(Get-RepoRoot)"
"RESULT hasgit=$("$(Test-HasGit)".ToLower())"`,
        ], cwd),
      feature: (s: Scripts, cwd: string) =>
        run("pwsh", [
          "-NoProfile",
          "-File",
          join(s.powershell, "create-new-feature.ps1"),
          "-Json",
          "-DryRun",
          "-ShortName",
          "demo",
          "Demo",
        ], cwd),
    }]
    : []),
];

const results = (r: Run) =>
  r.stdout.split(/\r?\n/).filter((l) => l.startsWith("RESULT ")).map((l) => l.slice(7));

/** What a scenario sets up under a fresh directory, and the answer both twins owe. */
type Fixture = { cwd: string; scripts: Scripts; root: string; hasGit: boolean };

async function mkdir(base: string, ...parts: string[]): Promise<string> {
  const dir = join(base, ...parts);
  await Deno.mkdir(dir, { recursive: true });
  return dir;
}

async function nested(tmp: string): Promise<{ project: string; scripts: Scripts }> {
  await git(tmp, "init", "-q", "-b", "main");
  const project = await mkdir(tmp, "sub");
  return { project, scripts: await install(project) };
}

/** Whether this process runs as root, which owns every directory a row could borrow. */
const ROOT_USER = (await run("id", ["-u"], ".").catch(() => undefined))?.stdout.trim() === "0";

const SCENARIOS: Array<{
  label: string;
  ignore?: boolean;
  setup: (tmp: string) => Promise<Fixture>;
}> = [
  {
    label: "a project at a git root is its own root, with git",
    setup: async (tmp) => {
      const project = await mkdir(tmp, "project");
      await git(project, "init", "-q", "-b", "main");
      return { cwd: project, scripts: await install(project), root: project, hasGit: true };
    },
  },
  {
    label: "a project in a subfolder of a parent repository is the subfolder, with git",
    setup: async (tmp) => {
      const { project, scripts } = await nested(tmp);
      return { cwd: project, scripts, root: project, hasGit: true };
    },
  },
  {
    label: "from a subdirectory of a nested project, the project",
    setup: async (tmp) => {
      const { project, scripts } = await nested(tmp);
      return { cwd: await mkdir(project, "src/deep"), scripts, root: project, hasGit: true };
    },
  },
  {
    label: "a project with its own repository inside another is the inner one",
    setup: async (tmp) => {
      await git(tmp, "init", "-q", "-b", "main");
      const project = await mkdir(tmp, "inner");
      await git(project, "init", "-q", "-b", "main");
      return { cwd: project, scripts: await install(project), root: project, hasGit: true };
    },
  },
  {
    label: "a .specnaut planted above a working directory outside the project is not the root",
    setup: async (tmp) => {
      const project = await mkdir(tmp, "project");
      const scripts = await install(project);
      // Both markers: the walk this replaced looked for `.specify`.
      await mkdir(tmp, "elsewhere/.specnaut");
      await mkdir(tmp, "elsewhere/.specify");
      return { cwd: await mkdir(tmp, "elsewhere/work"), scripts, root: project, hasGit: false };
    },
  },
  {
    label: "run in place with no .specnaut above, git's top level",
    setup: async (tmp) => {
      const repo = await mkdir(tmp, "repo");
      await git(repo, "init", "-q", "-b", "main");
      return { cwd: await mkdir(repo, "src"), scripts: IN_PLACE, root: repo, hasGit: true };
    },
  },
  {
    label: "run in place, the nearest .specnaut wins over a farther one and the repository",
    setup: async (tmp) => {
      await git(tmp, "init", "-q", "-b", "main");
      await mkdir(tmp, ".specnaut");
      const project = await mkdir(tmp, "sub");
      await mkdir(project, ".specnaut");
      return { cwd: await mkdir(project, "src"), scripts: IN_PLACE, root: project, hasGit: true };
    },
  },
  {
    // POSIX only: the foreign owner is borrowed through a symlink to `/`, and
    // Windows has neither that owner nor, without privilege, the link.
    label: "run in place, a .specnaut another user owns is passed over (POSIX)",
    ignore: WINDOWS || ROOT_USER,
    setup: async (tmp) => {
      await git(tmp, "init", "-q", "-b", "main");
      const project = await mkdir(tmp, "sub");
      await Deno.symlink("/", join(project, ".specnaut"));
      return { cwd: project, scripts: IN_PLACE, root: tmp, hasGit: true };
    },
  },
];

async function withTmp(fn: (tmp: string) => Promise<void>): Promise<void> {
  const tmp = await Deno.realPath(await Deno.makeTempDir({ prefix: "repo-root-twins-" }));
  try {
    await fn(tmp);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
}

for (const twin of TWINS) {
  for (const { label, ignore, setup } of SCENARIOS) {
    Deno.test({
      name: `repo root [${twin.name}]: ${label}`,
      ignore,
      fn: () =>
        withTmp(async (tmp) => {
          const f = await setup(tmp);
          const r = await twin.probe(f.scripts, f.cwd);
          assertEquals(
            results(r).map((l) => l.startsWith("root=") ? `root=${slashes(l.slice(5))}` : l),
            [`root=${slashes(f.root)}`, `hasgit=${f.hasGit}`],
            `stdout: ${r.stdout}\nstderr: ${r.stderr}`,
          );
        }),
    });
  }

  Deno.test(`repo root [${twin.name}]: a nested project's spec is written under it, on its branch`, () =>
    withTmp(async (tmp) => {
      const { project, scripts } = await nested(tmp);
      const r = await twin.feature(scripts, project);
      assertEquals(r.code, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
      const out = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "");
      assertEquals(out.BRANCH_NAME, "001-demo");
      assert(
        slashes(out.SPEC_FILE).startsWith(`${slashes(project)}/.specnaut/specs/001-demo/`),
        `the spec is not under the project: ${out.SPEC_FILE}`,
      );
    }));
}
