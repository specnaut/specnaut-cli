// cli#752 — a failure an entry script reports is said in text the script wrote,
// never in git's. Git's stderr names refs and paths a committer chose, and it
// reaches a terminal and an agent's context: `create-new-feature` printed it
// whole when a branch could not be created or switched to. PowerShell first
// (cli#752); the bash twin had the same lines, and both now print fixed text,
// plus at most an exit code.
//
// A marker in a ref name and in a file path stands for that text; it must reach
// neither stream, and the failure must still be named.

import { assert, assertNotEquals, assertStringIncludes } from "@std/assert";
import { copy } from "@std/fs";
import { fromFileUrl, join } from "@std/path";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import { git, type Run, run } from "./git_sandbox.ts";
import { guardPowerShellArm, PWSH_AVAILABLE } from "./pwsh_arm.ts";

const SCRIPTS = fromFileUrl(new URL("../../templates/core/specnaut/scripts/", import.meta.url));
const BASH = Deno.build.os === "darwin" ? "/bin/bash" : "bash";
const MARKER = "MARKERZX9";

guardPowerShellArm();

const TWINS = [
  {
    name: "bash",
    create: (dir: string, allowExisting: boolean) =>
      run(BASH, [
        bashPath(join(dir, ".specnaut/scripts/bash/create-new-feature.sh")),
        "--json",
        "--number",
        "1",
        "--short-name",
        "demo",
        ...(allowExisting ? ["--allow-existing-branch"] : []),
        "Demo",
      ], dir),
  },
  ...(PWSH_AVAILABLE
    ? [{
      name: "pwsh",
      create: (dir: string, allowExisting: boolean) =>
        run("pwsh", [
          "-NoProfile",
          "-File",
          join(dir, ".specnaut/scripts/powershell/create-new-feature.ps1"),
          "-Json",
          "-Number",
          "1",
          "-ShortName",
          "demo",
          ...(allowExisting ? ["-AllowExistingBranch"] : []),
          "Demo",
        ], dir),
    }]
    : []),
];

/** A repository with one commit on `main` and both twins installed, untracked. */
async function withRepo(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.realPath(await Deno.makeTempDir({ prefix: "fixed-text-twins-" }));
  try {
    await git(dir, "init", "-q", "-b", "main");
    await git(dir, "config", "commit.gpgsign", "false");
    await Deno.writeTextFile(join(dir, `${MARKER}.txt`), "a\n");
    await git(dir, "add", `${MARKER}.txt`);
    await git(dir, "commit", "-q", "-m", "base");
    await copy(SCRIPTS, join(dir, ".specnaut/scripts"));
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

function assertFixedText(r: Run, names: string): void {
  assertNotEquals(r.code, 0, `the failure went unreported:\n${r.stdout}${r.stderr}`);
  assertStringIncludes(r.stderr, names);
  assert(!r.stdout.includes(MARKER), `git's text reached stdout: ${r.stdout}`);
  assert(!r.stderr.includes(MARKER), `git's text reached stderr: ${r.stderr}`);
}

for (const twin of TWINS) {
  Deno.test(`fixed text [${twin.name}]: a branch git cannot create is named, git's reason is not`, () =>
    withRepo(async (dir) => {
      // `001-demo/MARKERZX9` makes `refs/heads/001-demo` impossible, and git's
      // "cannot lock ref" message quotes the ref that is in the way.
      await git(dir, "branch", `001-demo/${MARKER}`);
      assertFixedText(await twin.create(dir, false), "001-demo");
    }));

  Deno.test(`fixed text [${twin.name}]: an existing branch git cannot switch to is named, git's reason is not`, () =>
    withRepo(async (dir) => {
      // A local change to a file the branch also changed blocks the checkout,
      // and git's refusal lists that file by its path.
      await git(dir, "checkout", "-q", "-b", "001-demo");
      await Deno.writeTextFile(join(dir, `${MARKER}.txt`), "b\n");
      await git(dir, "commit", "-q", "-am", "on the branch");
      await git(dir, "checkout", "-q", "main");
      await Deno.writeTextFile(join(dir, `${MARKER}.txt`), "c\n");
      assertFixedText(await twin.create(dir, true), "001-demo");
    }));
}
