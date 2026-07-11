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
  const dir = await Deno.makeTempDir({ prefix: "specnaut-init-opencode-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("specnaut init --ai opencode scaffolds a complete OpenCode project layout", async () => {
  await withTempDir(async (parent) => {
    const { code, stderr } = await runSpecnaut(
      ["init", "demo", "--no-git", "--ai", "opencode"],
      { cwd: parent },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);

    const root = join(parent, "demo");

    // v1.0.0 consolidated layout: router + phase docs.
    assertEquals(
      await exists(join(root, ".opencode/skills/specnaut/SKILL.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".opencode/skills/specnaut/phases/specify.md")),
      true,
    );
    // /backlog command stays as a flat command file.
    assertEquals(
      await exists(join(root, ".opencode/commands/backlog.md")),
      true,
    );
    // Old per-phase command files are gone post-consolidation.
    assertEquals(
      await exists(join(root, ".opencode/commands/specnaut-specify.md")),
      false,
    );

    // Agents in .opencode/agents/ with mode: subagent + permission block
    const developerPath = join(root, ".opencode/agents/specnaut-developer.md");
    assertEquals(await exists(developerPath), true);
    const developer = await Deno.readTextFile(developerPath);
    assertStringIncludes(developer, "mode: subagent");
    assertStringIncludes(developer, "permission:");
    assertStringIncludes(developer, "read: allow");
    assertStringIncludes(developer, "bash:");

    // #409: the deprecated specnaut-auto alias no longer scaffolds.
    assertEquals(
      await exists(join(root, ".opencode/skills/specnaut-auto/SKILL.md")),
      false,
    );

    // Shared (cross-harness)
    assertEquals(await exists(join(root, ".specnaut/memory/constitution.md")), true);
    assertEquals(await exists(join(root, "AGENTS.md")), true);
    const agentsRoot = await Deno.readTextFile(join(root, "AGENTS.md"));
    assertEquals(agentsRoot.length > 0, true);
    assertEquals(await exists(join(root, "tasks/backlog.md")), false);
    assertEquals(await exists(join(root, ".specnaut/backlog.md")), true);

    // NOT emitted for opencode
    assertEquals(await exists(join(root, ".claude/")), false);
    assertEquals(await exists(join(root, ".cursor/")), false);
    assertEquals(await exists(join(root, ".agents/")), false);
    assertEquals(await exists(join(root, ".codex/")), false);
    assertEquals(await exists(join(root, ".windsurf/")), false);
    assertEquals(await exists(join(root, ".github/")), false);
    assertEquals(await exists(join(root, "CLAUDE.md")), false);

    // Lock reflects opencode
    const lock = await Deno.readTextFile(join(root, ".specnaut/installed.lock"));
    assertStringIncludes(lock, "harness: opencode");
  });
});
