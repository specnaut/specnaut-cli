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
  const dir = await Deno.makeTempDir({ prefix: "specflow-init-codex-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("specflow init --ai codex scaffolds a Codex layout", async () => {
  await withTempDir(async (parent) => {
    const { code, stderr } = await runSpecflow(
      ["init", "demo", "--no-git", "--ai", "codex"],
      { cwd: parent },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);

    const root = join(parent, "demo");

    // Codex team-shared skills
    assertEquals(await exists(join(root, ".agents/skills/specflow-specify/SKILL.md")), true);
    assertEquals(await exists(join(root, ".agents/skills/specflow-backlog/SKILL.md")), true);
    assertEquals(await exists(join(root, ".agents/skills/specflow-auto-chain/SKILL.md")), true);

    // Codex subagents (TOML)
    assertEquals(await exists(join(root, ".codex/agents/product-owner.toml")), true);
    const tomlContent = await Deno.readTextFile(
      join(root, ".codex/agents/product-owner.toml"),
    );
    const parsed = parseToml(tomlContent);
    assertEquals(parsed.name, "product-owner");
    assertEquals(typeof parsed.description, "string");
    assertEquals(typeof parsed.developer_instructions, "string");

    const agentsSkillsCount = (await Array.fromAsync(
      Deno.readDir(join(root, ".agents/skills")),
    )).length;
    assertEquals(agentsSkillsCount, 12);
    const codexAgentsCount = (await Array.fromAsync(
      Deno.readDir(join(root, ".codex/agents")),
    )).length;
    assertEquals(codexAgentsCount, 8);

    // Shared (cross-harness)
    assertEquals(await exists(join(root, ".specflow/memory/constitution.md")), true);
    assertEquals(await exists(join(root, "AGENTS.md")), true);
    assertEquals(await exists(join(root, "tasks/backlog.md")), true);

    // NOT emitted for codex
    assertEquals(await exists(join(root, ".claude/")), false);
    assertEquals(await exists(join(root, ".cursor/")), false);
    assertEquals(await exists(join(root, "CLAUDE.md")), false);

    // Lock reflects codex
    const lock = await Deno.readTextFile(join(root, ".specflow/installed.lock"));
    assertEquals(lock.includes("harness: codex"), true);
  });
});
