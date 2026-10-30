// cli#703 split `create-new-feature.{sh,ps1}` and `common.ps1` by extraction:
// each now sources a helper beside it. A project scaffolded before the split
// has the entry scripts but not the helpers, and the upgraded entry script
// sources a file that is not there — so `upgrade` must install the helpers as
// new files, and the scaffolded layout must actually resolve them.
//
// The test removes the helpers from disk and from the lock (a pre-split
// install), runs `upgrade`, and then runs the INSTALLED scripts, not the
// template copies: only the installed layout proves the relative source holds.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { fromFileUrl, join } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

const HELPERS = [
  ".specnaut/scripts/bash/branch-naming.sh",
  ".specnaut/scripts/powershell/branch-naming.ps1",
  ".specnaut/scripts/powershell/template-resolution.ps1",
];

async function exec(cmd: string, args: string[], cwd: string) {
  const { code, stdout, stderr } = await new Deno.Command(cmd, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

function specnaut(args: string[], cwd: string) {
  return exec("deno", [
    "run",
    "--allow-read",
    "--allow-write",
    "--allow-run",
    "--allow-env",
    MAIN,
    ...args,
  ], cwd);
}

async function hasPwsh(): Promise<boolean> {
  try {
    return (await exec("pwsh", ["-NoProfile", "-Command", "exit 0"], ".")).code === 0;
  } catch {
    return false;
  }
}

const PWSH_AVAILABLE = await hasPwsh();

/** Drop one path's entry (its key line and the indented lines under it) from the lock. */
function dropLockEntry(lock: string, rel: string): string {
  const lines = lock.split("\n");
  const start = lines.indexOf(`  ${rel}:`);
  assert(start >= 0, `the lock has no entry for ${rel}`);
  let end = start + 1;
  while (end < lines.length && lines[end].startsWith("    ")) end++;
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
}

/** A project as it stood before the split: entry scripts present, helpers absent. */
async function preSplitProject(parent: string): Promise<string> {
  const init = await specnaut(["init", "demo", "--no-git"], parent);
  assertEquals(init.code, 0, init.stderr);
  const project = join(parent, "demo");
  const lockPath = join(project, ".specnaut/installed.lock");
  let lock = await Deno.readTextFile(lockPath);
  for (const rel of HELPERS) {
    await Deno.remove(join(project, rel));
    lock = dropLockEntry(lock, rel);
  }
  await Deno.writeTextFile(lockPath, lock);
  return project;
}

Deno.test("upgrade installs the helpers the split scripts source, and the installed scripts run", async () => {
  const parent = await Deno.makeTempDir({ prefix: "specnaut-upgrade-split-" });
  try {
    const project = await preSplitProject(parent);

    const upgrade = await specnaut(["upgrade"], project);
    assertEquals(upgrade.code, 0, upgrade.stderr);
    const lock = await Deno.readTextFile(join(project, ".specnaut/installed.lock"));
    for (const rel of HELPERS) {
      assert(await exists(join(project, rel)), `upgrade did not install ${rel}`);
      assertStringIncludes(lock, `  ${rel}:`, `upgrade did not record ${rel} in the lock`);
    }

    // The marker only the sourced helper's code can produce: a computed name.
    const sh = await exec("bash", [
      ".specnaut/scripts/bash/create-new-feature.sh",
      "--json",
      "--dry-run",
      "Add user authentication system",
    ], project);
    assertEquals(sh.code, 0, sh.stderr);
    assertStringIncludes(sh.stdout, '"BRANCH_NAME":"001-user-authentication-system"');

    if (PWSH_AVAILABLE) {
      const ps = await exec("pwsh", [
        "-NoProfile",
        "-File",
        ".specnaut/scripts/powershell/create-new-feature.ps1",
        "-Json",
        "-DryRun",
        "Add user authentication system",
      ], project);
      assertEquals(ps.code, 0, ps.stderr);
      assertStringIncludes(ps.stdout, '"BRANCH_NAME":"001-user-authentication-system"');

      // common.ps1 is dot-sourced by every PowerShell entry script; its
      // template functions now come from the helper beside it.
      const common = await exec("pwsh", [
        "-NoProfile",
        "-Command",
        ". ./.specnaut/scripts/powershell/common.ps1; " +
        "Resolve-Template -TemplateName 'plan-template' -RepoRoot (Get-Location).Path",
      ], project);
      assertEquals(common.code, 0, common.stderr);
      assertStringIncludes(common.stdout, "plan-template.md");
    } else if (Deno.env.get("CI") === "true") {
      throw new Error("pwsh is absent on CI — the PowerShell arm did not run");
    } else {
      console.log("  note: pwsh not installed — PowerShell arm skipped locally");
    }
  } finally {
    await Deno.remove(parent, { recursive: true });
  }
});
