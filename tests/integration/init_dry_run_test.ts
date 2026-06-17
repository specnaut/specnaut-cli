import { assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { fromFileUrl, join } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

async function runSpecnaut(
  args: string[],
  opts: { cwd?: string } = {},
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
  const dir = await Deno.makeTempDir({ prefix: "specnaut-init-dry-run-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test(
  "init --dry-run on a fresh dir exits 0 without writing anything",
  async () => {
    await withTempDir(async (dir) => {
      const result = await runSpecnaut(
        ["init", "demo", "--no-git", "--dry-run"],
        { cwd: dir },
      );
      assertEquals(result.code, 0, `stderr: ${result.stderr}`);
      assertStringIncludes(result.stdout, "dry-run");

      // Nothing should have been written to disk.
      assertEquals(await exists(join(dir, "demo/.claude")), false);
      assertEquals(await exists(join(dir, "demo/.specnaut")), false);
      assertEquals(await exists(join(dir, "demo/AGENTS.md")), false);
    });
  },
);

Deno.test(
  "init --force --dry-run honours dry-run (does not overwrite existing files)",
  async () => {
    await withTempDir(async (dir) => {
      // Pre-seed a project: real init landed a router skill, the user
      // customised it.
      const skillPath = join(dir, "demo/.claude/skills/specnaut/SKILL.md");
      await Deno.mkdir(join(dir, "demo/.claude/skills/specnaut"), {
        recursive: true,
      });
      const ORIGINAL = "CUSTOM CONTENT FROM USER";
      await Deno.writeTextFile(skillPath, ORIGINAL);

      // Dry-run + force must NOT touch the file, NOT create a .specnaut.bak,
      // and NOT write the lock.
      const result = await runSpecnaut(
        ["init", "demo", "--no-git", "--force", "--dry-run"],
        { cwd: dir },
      );
      assertEquals(result.code, 0, `stderr: ${result.stderr}`);
      assertStringIncludes(result.stdout, "dry-run");

      // Original file is untouched.
      const content = await Deno.readTextFile(skillPath);
      assertEquals(content, ORIGINAL);

      // No backup created.
      assertEquals(await exists(`${skillPath}.specnaut.bak`), false);

      // No lock file written.
      assertEquals(
        await exists(join(dir, "demo/.specnaut/installed.lock")),
        false,
      );
    });
  },
);

Deno.test(
  "init --here --force --dry-run inside an existing project does not write",
  async () => {
    await withTempDir(async (dir) => {
      // Simulate the Cloud-scaffold reproduction: existing AGENTS.md the user
      // tweaked, run init --here --force --dry-run — content must survive.
      const agentsPath = join(dir, "AGENTS.md");
      const ORIGINAL_AGENTS = "# Project AGENTS\n\nProject-specific notes.\n";
      await Deno.writeTextFile(agentsPath, ORIGINAL_AGENTS);

      const result = await runSpecnaut(
        [
          "init",
          "--here",
          "--no-git",
          "--force",
          "--dry-run",
          "--ai",
          "claude",
          "--backlog",
          "local",
        ],
        { cwd: dir },
      );
      assertEquals(result.code, 0, `stderr: ${result.stderr}`);

      // AGENTS.md content survives — this is the regression we're guarding.
      const content = await Deno.readTextFile(agentsPath);
      assertEquals(content, ORIGINAL_AGENTS);

      // No .specnaut.bak siblings.
      assertEquals(await exists(`${agentsPath}.specnaut.bak`), false);

      // No managed dirs created.
      assertEquals(await exists(join(dir, ".claude")), false);
      assertEquals(await exists(join(dir, ".specnaut")), false);
    });
  },
);
