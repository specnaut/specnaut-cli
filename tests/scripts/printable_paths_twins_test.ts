// cli#752 — a folder name is text a committer chose, and `setup-plan` printed it
// whole: the paths it resolves from `.specnaut/specs/<folder>` and the branch it
// falls back to when git names none. An ESC in that name reached the terminal
// and an agent's context. Both twins print it with every control character as
// `?`; the -Json object still carries the real path, escaped by the encoder.
//
// Not on Windows: NTFS refuses a control character in a file name.

import { assert, assertEquals, assertNotEquals, assertStringIncludes } from "@std/assert";
import { copy } from "@std/fs";
import { fromFileUrl, join } from "@std/path";
import { bashPath } from "../templates/hooks/hook_sandbox.ts";
import { git, type Run, run } from "./git_sandbox.ts";
import { guardPowerShellArm, PWSH_AVAILABLE } from "./pwsh_arm.ts";

const SCRIPTS = fromFileUrl(new URL("../../templates/core/specnaut/scripts/", import.meta.url));
const BASH = Deno.build.os === "darwin" ? "/bin/bash" : "bash";
const FOLDER = "001-a\x1bb";
const SHOWN = "001-a?b";

guardPowerShellArm();

const TWINS = [
  {
    name: "bash",
    setupPlan: (dir: string, json: boolean) =>
      run(BASH, [
        bashPath(join(dir, ".specnaut/scripts/bash/setup-plan.sh")),
        ...(json ? ["--json"] : []),
      ], dir),
  },
  ...(PWSH_AVAILABLE
    ? [{
      name: "pwsh",
      setupPlan: (dir: string, json: boolean) =>
        run("pwsh", [
          "-NoProfile",
          "-File",
          join(dir, ".specnaut/scripts/powershell/setup-plan.ps1"),
          ...(json ? ["-Json"] : []),
        ], dir),
    }]
    : []),
];

/** A project with both twins installed, a plan template, and the ESC-named spec folder. */
async function withProject(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.realPath(await Deno.makeTempDir({ prefix: "printable-paths-" }));
  try {
    await copy(SCRIPTS, join(dir, ".specnaut/scripts"));
    await Deno.mkdir(join(dir, ".specnaut/templates"), { recursive: true });
    await Deno.writeTextFile(join(dir, ".specnaut/templates/plan-template.md"), "# Plan\n");
    await Deno.mkdir(join(dir, ".specnaut/specs", FOLDER), { recursive: true });
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

function assertNoEsc(r: Run): void {
  assert(!r.stdout.includes("\x1b"), `an ESC reached stdout: ${JSON.stringify(r.stdout)}`);
  assert(!r.stderr.includes("\x1b"), `an ESC reached stderr: ${JSON.stringify(r.stderr)}`);
}

for (const twin of TWINS) {
  Deno.test({
    name: `printable paths [${twin.name}]: setup-plan prints an ESC-named spec folder as ?`,
    ignore: Deno.build.os === "windows",
    fn: () =>
      withProject(async (dir) => {
        // No git: the branch is the latest spec folder, and so is the plan's home.
        const text = await twin.setupPlan(dir, false);
        assertEquals(text.code, 0, text.stderr);
        assertNoEsc(text);
        assertStringIncludes(text.stdout, `Copied plan template to `);
        assertStringIncludes(text.stdout, `IMPL_PLAN: `);
        assertStringIncludes(text.stdout, `${SHOWN}/plan.md\n`);
        assertStringIncludes(text.stdout, `BRANCH: ${SHOWN}`);

        const json = await twin.setupPlan(dir, true);
        assertEquals(json.code, 0, json.stderr);
        assertNoEsc(json);
        assertStringIncludes(json.stderr, `${SHOWN}/plan.md - left untouched`);
        const obj = JSON.parse(json.stdout);
        assert(obj.SPECS_DIR.endsWith(FOLDER), `the JSON lost the real path: ${obj.SPECS_DIR}`);
        assertEquals(obj.BRANCH, FOLDER);
      }),
  });

  Deno.test({
    name: `printable paths [${twin.name}]: the contradiction refusal prints the branch as ?`,
    ignore: Deno.build.os === "windows",
    fn: () =>
      withProject(async (dir) => {
        // An unborn HEAD names no branch, so the latest spec folder stands for it.
        await git(dir, "init", "-q", "-b", "main");
        await Deno.writeTextFile(
          join(dir, ".specnaut/feature.json"),
          JSON.stringify({ feature_directory: ".specnaut/specs/002-other" }),
        );
        const r = await twin.setupPlan(dir, false);
        assertNotEquals(r.code, 0, r.stdout);
        assertNoEsc(r);
        assertStringIncludes(r.stderr, `current branch:  ${SHOWN}`);
      }),
  });
}
