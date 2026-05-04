import { assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { fromFileUrl, join } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

async function runSpecflow(
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
  const dir = await Deno.makeTempDir({ prefix: "specflow-init-opencode-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("specflow init --ai opencode scaffolds a complete OpenCode project layout", async () => {
  await withTempDir(async (parent) => {
    const { code, stderr } = await runSpecflow(
      ["init", "demo", "--no-git", "--ai", "opencode"],
      { cwd: parent },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);

    const root = join(parent, "demo");

    // Commands in .opencode/commands/
    assertEquals(
      await exists(join(root, ".opencode/commands/specflow.specify.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".opencode/commands/specflow.plan.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".opencode/commands/backlog.md")),
      true,
    );

    // Agents in .opencode/agents/ with mode: subagent + permission block
    const developerPath = join(root, ".opencode/agents/specflow-developer.md");
    assertEquals(await exists(developerPath), true);
    const developer = await Deno.readTextFile(developerPath);
    assertStringIncludes(developer, "mode: subagent");
    assertStringIncludes(developer, "permission:");
    assertStringIncludes(developer, "read: allow");
    assertStringIncludes(developer, "bash:");

    // Skills in .opencode/skills/specflow-<name>/SKILL.md
    const autoChainSkill = await Deno.readTextFile(
      join(root, ".opencode/skills/specflow-auto-chain/SKILL.md"),
    );
    assertStringIncludes(autoChainSkill, "name: auto-chain");

    // Shared (cross-harness)
    assertEquals(await exists(join(root, ".specflow/memory/constitution.md")), true);
    assertEquals(await exists(join(root, "AGENTS.md")), true);
    const agentsRoot = await Deno.readTextFile(join(root, "AGENTS.md"));
    assertEquals(agentsRoot.length > 0, true);
    assertEquals(await exists(join(root, "tasks/backlog.md")), false);
    assertEquals(await exists(join(root, ".specflow/backlog.md")), true);

    // NOT emitted for opencode
    assertEquals(await exists(join(root, ".claude/")), false);
    assertEquals(await exists(join(root, ".cursor/")), false);
    assertEquals(await exists(join(root, ".agents/")), false);
    assertEquals(await exists(join(root, ".codex/")), false);
    assertEquals(await exists(join(root, ".gemini/")), false);
    assertEquals(await exists(join(root, ".windsurf/")), false);
    assertEquals(await exists(join(root, ".github/")), false);
    assertEquals(await exists(join(root, "CLAUDE.md")), false);

    // Lock reflects opencode
    const lock = await Deno.readTextFile(join(root, ".specflow/installed.lock"));
    assertStringIncludes(lock, "harness: opencode");
  });
});
