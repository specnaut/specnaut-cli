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

Deno.test("upgrade migrates legacy tasks/backlog paths into .specflow/", async () => {
  await withTempDir(async (parent) => {
    const init = await runSpecflow(["init", "demo", "--no-git"], { cwd: parent });
    assertEquals(init.code, 0);

    const projectDir = join(parent, "demo");

    // Simulate a project that pre-dates #45: the new index doesn't exist
    // yet (the user installed Specflow before the path moved), and the
    // legacy layout under tasks/ is in place.
    await Deno.remove(join(projectDir, ".specflow/backlog.md"));
    await Deno.mkdir(join(projectDir, "tasks/backlog"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "tasks/backlog.md"),
      "# Legacy backlog index\n",
    );
    await Deno.writeTextFile(
      join(projectDir, "tasks/backlog/001-legacy.md"),
      "# Legacy task\n",
    );

    const upgrade = await runSpecflow(["upgrade"], { cwd: projectDir });
    assertEquals(upgrade.code, 0, `upgrade failed: ${upgrade.stderr}`);
    assertStringIncludes(upgrade.stdout, "tasks/backlog.md → .specflow/backlog.md");
    assertStringIncludes(upgrade.stdout, "tasks/backlog/ → .specflow/backlog/");

    // Old paths gone, new paths populated with the user's content preserved.
    assertEquals(await exists(join(projectDir, "tasks/backlog.md")), false);
    assertEquals(await exists(join(projectDir, "tasks/backlog")), false);
    assertEquals(await exists(join(projectDir, "tasks")), false); // tidy-up
    const migratedIndex = await Deno.readTextFile(
      join(projectDir, ".specflow/backlog.md"),
    );
    assertStringIncludes(migratedIndex, "Legacy backlog index");
    const migratedTask = await Deno.readTextFile(
      join(projectDir, ".specflow/backlog/001-legacy.md"),
    );
    assertStringIncludes(migratedTask, "Legacy task");
  });
});

Deno.test("upgrade migrates legacy specs/ into .specflow/specs/", async () => {
  await withTempDir(async (parent) => {
    const init = await runSpecflow(["init", "demo", "--no-git"], { cwd: parent });
    assertEquals(init.code, 0);

    const projectDir = join(parent, "demo");

    // Simulate a project that pre-dates #67: a feature directory exists
    // at the legacy top-level `specs/` path (where SpecKit puts them).
    await Deno.mkdir(join(projectDir, "specs/001-legacy-feature"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "specs/001-legacy-feature/spec.md"),
      "# Legacy spec\n",
    );

    const upgrade = await runSpecflow(["upgrade"], { cwd: projectDir });
    assertEquals(upgrade.code, 0, `upgrade failed: ${upgrade.stderr}`);
    assertStringIncludes(upgrade.stdout, "specs/ → .specflow/specs/");

    // Old path gone, new path populated with the user's content preserved.
    assertEquals(await exists(join(projectDir, "specs")), false);
    const migrated = await Deno.readTextFile(
      join(projectDir, ".specflow/specs/001-legacy-feature/spec.md"),
    );
    assertStringIncludes(migrated, "Legacy spec");
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
