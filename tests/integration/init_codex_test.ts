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

    // Codex team-shared skills (v1.0.0 consolidated layout)
    assertEquals(await exists(join(root, ".agents/skills/specflow/SKILL.md")), true);
    assertEquals(
      await exists(join(root, ".agents/skills/specflow/phases/specify.md")),
      true,
    );
    assertEquals(await exists(join(root, ".agents/skills/specflow-backlog/SKILL.md")), true);
    assertEquals(await exists(join(root, ".agents/skills/specflow-auto/SKILL.md")), true);
    // Old per-phase folders are gone post-consolidation.
    assertEquals(
      await exists(join(root, ".agents/skills/specflow-specify/SKILL.md")),
      false,
    );

    // Codex subagents (TOML)
    assertEquals(await exists(join(root, ".codex/agents/product-owner.toml")), true);
    const tomlContent = await Deno.readTextFile(
      join(root, ".codex/agents/product-owner.toml"),
    );
    const parsed = parseToml(tomlContent);
    assertEquals(parsed.name, "product-owner");
    assertEquals(typeof parsed.description, "string");
    assertEquals(typeof parsed.developer_instructions, "string");
    // The bundled product-owner declares `model: opus`, which maps to the
    // Codex reasoning-effort tier "high" (not a copied vendor model id).
    assertEquals(parsed.model_reasoning_effort, "high");

    // Codex harness reference doc + /goal prompt template
    assertEquals(await exists(join(root, ".codex/AGENTS.md")), true);
    assertEquals(await exists(join(root, ".codex/goal.md")), true);
    const codexAgentsMd = await Deno.readTextFile(join(root, ".codex/AGENTS.md"));
    assertEquals(codexAgentsMd.includes("# Codex Reference"), true);
    assertEquals(codexAgentsMd.includes("## Optional integrations"), true);
    assertEquals(codexAgentsMd.includes(".codex/goal.md"), true);
    const codexGoalMd = await Deno.readTextFile(join(root, ".codex/goal.md"));
    assertEquals(codexGoalMd.includes("# Project goal prompt"), true);
    assertEquals(codexGoalMd.includes("## Default goal prompt"), true);
    assertEquals(codexGoalMd.includes("/specflow groom"), true);

    // Top-level skill folders post-consolidation: specflow router +
    // specflow-auto + specflow-review alias + specflow-backlog +
    // writing-plans (A1) + requesting-code-review (A3) +
    // using-specflow bootstrap (B6) + subagent-driven-development (A2) +
    // executing-plans (A4) + verification-before-completion (A5) +
    // brainstorming (A6) + 4 output-contract skills (#378:
    // workflow-contract, handoff-protocol, review-findings-contract,
    // qa-report-contract) + code-audit (#379) + 5 per-axis audit skills
    // (#380: arch-audit, sec-audit, perf-audit, dep-audit, a11y-audit) +
    // status-audit (#381) = 22.
    // The audit-security phase (#303) lands under specflow/phases/, not as a
    // top-level skill — no bump there. code-audit's scope script ships under
    // .specflow/scripts/code-audit/, not as a skill folder; status-audit's
    // schema doc ships to .specflow/logs/README.md, also not a skill folder.
    const agentsSkillsCount = (await Array.fromAsync(
      Deno.readDir(join(root, ".agents/skills")),
    )).length;
    assertEquals(agentsSkillsCount, 22);
    const codexAgentsCount = (await Array.fromAsync(
      Deno.readDir(join(root, ".codex/agents")),
    )).length;
    // 11 original + performance-auditor (#304) + a11y-auditor (#305) +
    // architecture-auditor (#321) + dependency-auditor (#322) = 15.
    assertEquals(codexAgentsCount, 15);

    // Shared (cross-harness)
    assertEquals(await exists(join(root, ".specflow/memory/constitution.md")), true);
    assertEquals(await exists(join(root, "AGENTS.md")), true);
    assertEquals(await exists(join(root, "tasks/backlog.md")), false);
    assertEquals(await exists(join(root, ".specflow/backlog.md")), true);

    // NOT emitted for codex
    assertEquals(await exists(join(root, ".claude/")), false);
    assertEquals(await exists(join(root, ".cursor/")), false);
    assertEquals(await exists(join(root, "CLAUDE.md")), false);

    // Lock reflects codex
    const lock = await Deno.readTextFile(join(root, ".specflow/installed.lock"));
    assertEquals(lock.includes("harness: codex"), true);
  });
});
