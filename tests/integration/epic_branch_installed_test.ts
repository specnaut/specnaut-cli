// cli#733 — the epic branch lookup in the INSTALLED layout. create-new-feature
// calls epic-branch.sh beside it; run from templates/, the helper is always
// there, so only an installed project proves the manifest ships it (it did
// not, once, and only manifest_registration_test noticed).

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));
const EPIC = 7;

/** No global or system git config, no inherited `GIT_*`: the fixture is all a child reads. */
const ENV = {
  ...Object.fromEntries(Object.entries(Deno.env.toObject()).filter(([k]) => !/^GIT_/.test(k))),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

async function exec(cmd: string, args: string[], cwd: string) {
  const { code, stdout, stderr } = await new Deno.Command(cmd, {
    args,
    cwd,
    env: ENV,
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const dec = new TextDecoder();
  return { code, out: dec.decode(stdout) + dec.decode(stderr) };
}

async function git(cwd: string, ...args: string[]) {
  const r = await exec("git", args, cwd);
  assertEquals(r.code, 0, `git ${args.join(" ")}: ${r.out}`);
  return r.out.trim();
}

async function hasPwsh(): Promise<boolean> {
  try {
    return (await exec("pwsh", ["-NoProfile", "-Command", "exit 0"], ".")).code === 0;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}
const PWSH_AVAILABLE = await hasPwsh();

/** An installed project on `main`, its backlog stubbed (42 is a child of 7), and the epic's branch. */
async function installedWithEpicBranch(parent: string): Promise<string> {
  const init = await exec("deno", [
    "run",
    "--allow-read",
    "--allow-write",
    "--allow-run",
    "--allow-env",
    MAIN,
    "init",
    "demo",
    "--no-git",
  ], parent);
  assertEquals(init.code, 0, init.out);
  const project = join(parent, "demo");
  const backlog = join(project, ".specnaut/scripts/backlog");
  await Deno.writeTextFile(join(backlog, "parent-of.sh"), `#!/usr/bin/env bash\necho ${EPIC}\n`);
  await Deno.writeTextFile(join(backlog, "cascade-check.sh"), "#!/usr/bin/env bash\nexit 0\n");
  await git(project, "init", "-q", "-b", "main");
  await git(project, "config", "init.defaultBranch", "main");
  await git(project, "config", "user.email", "t@example.invalid");
  await git(project, "config", "user.name", "t");
  await git(project, "config", "commit.gpgsign", "false");
  await git(project, "add", "-A");
  await git(project, "commit", "-qm", "init");
  await git(project, "checkout", "-q", "-b", "005-epic");
  await Deno.writeTextFile(
    join(project, ".specnaut/feature.json"),
    JSON.stringify({ linked_issue: EPIC }) + "\n",
  );
  await git(project, "add", ".specnaut/feature.json");
  await git(project, "commit", "-qm", `plan(${EPIC}): link the branch to its task`);
  await git(project, "checkout", "-q", "main");
  return project;
}

Deno.test("installed create-new-feature --issue <child> finds the epic's branch through the installed helper", async () => {
  const parent = await Deno.makeTempDir({ prefix: "specnaut-epic-installed-" });
  try {
    const project = await installedWithEpicBranch(parent);
    const runs: [string, string[]][] = [[
      "bash",
      [".specnaut/scripts/bash/create-new-feature.sh", "--json", "--issue", "42", "a child"],
    ]];
    if (PWSH_AVAILABLE) {
      runs.push(["pwsh", [
        "-NoProfile",
        "-File",
        ".specnaut/scripts/powershell/create-new-feature.ps1",
        "-Json",
        "-Issue",
        "42",
        "a child",
      ]]);
    } else if (Deno.env.get("CI") === "true") {
      throw new Error("pwsh is absent on CI — the PowerShell arm did not run");
    }
    for (const [cmd, args] of runs) {
      const r = await exec(cmd, args, project);
      assertEquals(r.code, 0, `${cmd}: ${r.out}`);
      assertStringIncludes(r.out, `epic #${EPIC} already has branch '005-epic'`, cmd);
      assertEquals(await git(project, "rev-parse", "--abbrev-ref", "HEAD"), "005-epic", cmd);
      await git(project, "checkout", "-q", "main");
    }
  } finally {
    await Deno.remove(parent, { recursive: true });
  }
});
