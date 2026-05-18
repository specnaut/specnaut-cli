import { assertEquals } from "@std/assert";
import { exists } from "@std/fs/exists";
import { parse as parseToml } from "@std/toml";
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
  const dir = await Deno.makeTempDir({ prefix: "specflow-init-gemini-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("specflow init --ai gemini scaffolds a Gemini layout", async () => {
  await withTempDir(async (parent) => {
    const { code, stderr } = await runSpecflow(
      ["init", "demo", "--no-git", "--ai", "gemini"],
      { cwd: parent },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);

    const root = join(parent, "demo");

    // v1.0.0 consolidated layout: router skill + 11 phase docs.
    assertEquals(
      await exists(join(root, ".gemini/skills/specflow/SKILL.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".gemini/skills/specflow/phases/specify.md")),
      true,
    );
    // Backlog command stays as TOML.
    assertEquals(
      await exists(join(root, ".gemini/commands/specflow-backlog.toml")),
      true,
    );
    const cmdContent = await Deno.readTextFile(
      join(root, ".gemini/commands/specflow-backlog.toml"),
    );
    const parsedCmd = parseToml(cmdContent);
    assertEquals(typeof parsedCmd.prompt, "string");

    // Markdown skill
    assertEquals(
      await exists(join(root, ".gemini/skills/specflow-auto/SKILL.md")),
      true,
    );
    // Old per-phase commands are gone post-consolidation.
    assertEquals(
      await exists(join(root, ".gemini/commands/specflow-specify.toml")),
      false,
    );

    // Markdown subagent — frontmatter has only name + description
    assertEquals(await exists(join(root, ".gemini/agents/product-owner.md")), true);
    const agentContent = await Deno.readTextFile(
      join(root, ".gemini/agents/product-owner.md"),
    );
    assertEquals(agentContent.includes("name: product-owner"), true);
    assertEquals(agentContent.includes("description:"), true);
    assertEquals(agentContent.includes("model:"), false);
    assertEquals(agentContent.includes("tools:"), false);

    // Only the /backlog command remains under .gemini/commands/ post-consolidation.
    const commandsCount = (await Array.fromAsync(
      Deno.readDir(join(root, ".gemini/commands")),
    )).length;
    assertEquals(commandsCount, 1);
    const agentsCount = (await Array.fromAsync(
      Deno.readDir(join(root, ".gemini/agents")),
    )).length;
    // 11 original + performance-auditor (#304) + a11y-auditor (#305) +
    // architecture-auditor (#321) + dependency-auditor (#322) = 15.
    assertEquals(agentsCount, 15);

    // Shared (cross-harness)
    assertEquals(await exists(join(root, ".specflow/memory/constitution.md")), true);
    assertEquals(await exists(join(root, "AGENTS.md")), true);
    assertEquals(await exists(join(root, "tasks/backlog.md")), false);
    assertEquals(await exists(join(root, ".specflow/backlog.md")), true);

    // NOT emitted for gemini
    assertEquals(await exists(join(root, ".claude/")), false);
    assertEquals(await exists(join(root, ".cursor/")), false);
    assertEquals(await exists(join(root, ".agents/")), false);
    assertEquals(await exists(join(root, ".codex/")), false);
    assertEquals(await exists(join(root, "CLAUDE.md")), false);

    // Lock reflects gemini
    const lock = await Deno.readTextFile(join(root, ".specflow/installed.lock"));
    assertEquals(lock.includes("harness: gemini"), true);
  });
});
