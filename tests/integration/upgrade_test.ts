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

// Regression guard for #163: a fresh init followed by `upgrade --dry-run`
// MUST report "already up to date". Before the fix, AGENTS.md and
// .specflow/memory/constitution.md (skipIfExists files) were classified
// as "customized locally" because they had no lock entry. The guard
// catches any future regression that re-introduces a similar
// false-positive on a never-edited project.
Deno.test("upgrade --dry-run on freshly-init'd project reports zero customized files", async () => {
  await withTempDir(async (parent) => {
    const init = await runSpecflow(["init", "demo", "--no-git"], { cwd: parent });
    assertEquals(init.code, 0);

    const projectDir = join(parent, "demo");
    const dry = await runSpecflow(["upgrade", "--dry-run"], { cwd: projectDir });
    assertEquals(dry.code, 0, dry.stderr);
    assertStringIncludes(dry.stdout, "already up to date");
    assertEquals(
      dry.stdout.includes("customized locally"),
      false,
      "fresh init must not produce any customized-locally warning",
    );
  });
});

// `--reset-baseline` is a no-op on a clean install (nothing to heal) but
// must not error out. Smoke-tests that the flag plumbing works end-to-end.
Deno.test("upgrade --reset-baseline on freshly-init'd project is also up-to-date", async () => {
  await withTempDir(async (parent) => {
    const init = await runSpecflow(["init", "demo", "--no-git"], { cwd: parent });
    assertEquals(init.code, 0);

    const projectDir = join(parent, "demo");
    const upgrade = await runSpecflow(["upgrade", "--reset-baseline", "--dry-run"], {
      cwd: projectDir,
    });
    assertEquals(upgrade.code, 0, upgrade.stderr);
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

Deno.test("upgrade auto-deletes a clean orphan and drops it from the lock", async () => {
  await withTempDir(async (parent) => {
    const init = await runSpecflow(["init", "demo", "--no-git"], { cwd: parent });
    assertEquals(init.code, 0);

    const projectDir = join(parent, "demo");
    const orphanRel = ".claude/commands/specflow.fake-orphan.md";
    const orphanAbs = join(projectDir, orphanRel);
    const orphanContent = "fake orphan content\n";
    await Deno.writeTextFile(orphanAbs, orphanContent);

    // Compute SHA-256 of the orphan content (matches the lock format).
    const buf = new TextEncoder().encode(orphanContent);
    const hash = await crypto.subtle.digest("SHA-256", buf);
    const orphanSha = Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Inject a fake orphan entry into the existing installed.lock.
    const lockPath = join(projectDir, ".specflow/installed.lock");
    const lockYaml = await Deno.readTextFile(lockPath);
    const injected = lockYaml.replace(
      /(entries:\s*\n)/,
      `$1  ${orphanRel}:\n` +
        `    sha256: ${orphanSha}\n` +
        `    installed_at: "2026-04-25T00:00:00Z"\n` +
        `    templates_version: "0.7.0"\n`,
    );
    await Deno.writeTextFile(lockPath, injected);

    const upgrade = await runSpecflow(["upgrade"], { cwd: projectDir });
    assertEquals(upgrade.code, 0);

    // Orphan file deleted on disk.
    assertEquals(await exists(orphanAbs), false);

    // Lock no longer contains the orphan entry.
    const newLockYaml = await Deno.readTextFile(lockPath);
    assertEquals(newLockYaml.includes("specflow.fake-orphan.md"), false);
  });
});
