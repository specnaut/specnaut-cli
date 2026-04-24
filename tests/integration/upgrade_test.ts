import { assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { fromFileUrl, join } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

async function runSpecflow(
  args: string[],
  opts: { cwd: string },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const p = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-run",
      "--allow-env",
      MAIN,
      ...args,
    ],
    cwd: opts.cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await p.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "specflow-upgrade-integ-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("upgrade on freshly-init'd project is up-to-date", async () => {
  await withTempDir(async (parent) => {
    const init = await runSpecflow(["init", "demo", "--no-git"], { cwd: parent });
    assertEquals(init.code, 0);

    const projectDir = join(parent, "demo");
    const upgrade = await runSpecflow(["upgrade"], { cwd: projectDir });
    assertEquals(upgrade.code, 0);
    assertStringIncludes(upgrade.stdout, "already up to date");
  });
});

Deno.test("upgrade fails with clear message when lock missing", async () => {
  await withTempDir(async (dir) => {
    const upgrade = await runSpecflow(["upgrade"], { cwd: dir });
    assertEquals(upgrade.code, 2);
    assertStringIncludes(upgrade.stderr, "installed.lock");
  });
});

Deno.test("upgrade --dry-run shows plan without writing when user customized a file", async () => {
  await withTempDir(async (parent) => {
    const init = await runSpecflow(["init", "demo", "--no-git"], { cwd: parent });
    assertEquals(init.code, 0);

    const projectDir = join(parent, "demo");
    const agentsPath = join(projectDir, "AGENTS.md");
    const original = await Deno.readTextFile(agentsPath);
    await Deno.writeTextFile(agentsPath, original + "\n\n# User customization\n");

    const upgrade = await runSpecflow(["upgrade", "--dry-run"], { cwd: projectDir });
    assertEquals(upgrade.code, 0);
    assertStringIncludes(upgrade.stdout, "AGENTS.md");
    assertStringIncludes(upgrade.stdout, "customized locally");
    const after = await Deno.readTextFile(agentsPath);
    assertEquals(after.includes("# User customization"), true);
  });
});

Deno.test("upgrade --force overwrites a customized file with backup", async () => {
  await withTempDir(async (parent) => {
    const init = await runSpecflow(["init", "demo", "--no-git"], { cwd: parent });
    assertEquals(init.code, 0);

    const projectDir = join(parent, "demo");
    const agentsPath = join(projectDir, "AGENTS.md");
    const original = await Deno.readTextFile(agentsPath);
    await Deno.writeTextFile(agentsPath, original + "\n# User customization\n");

    const upgrade = await runSpecflow(["upgrade", "--force"], { cwd: projectDir });
    assertEquals(upgrade.code, 0);

    const backupExists = await exists(`${agentsPath}.specflow.bak`);
    assertEquals(backupExists, true);

    const bak = await Deno.readTextFile(`${agentsPath}.specflow.bak`);
    assertEquals(bak.includes("# User customization"), true);

    const after = await Deno.readTextFile(agentsPath);
    assertEquals(after.includes("# User customization"), false);
  });
});
