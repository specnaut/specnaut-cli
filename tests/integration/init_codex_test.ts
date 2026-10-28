import { assertEquals } from "@std/assert";
import { exists } from "@std/fs/exists";
import { parse as parseToml } from "@std/toml";
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
  const dir = await Deno.makeTempDir({ prefix: "specnaut-init-codex-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("specnaut init --ai codex scaffolds a Codex layout", async () => {
  await withTempDir(async (parent) => {
    const { code, stderr } = await runSpecnaut(
      ["init", "demo", "--no-git", "--ai", "codex"],
      { cwd: parent },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);

    const root = join(parent, "demo");

    // Codex team-shared skills (v1.0.0 consolidated layout)
    assertEquals(await exists(join(root, ".agents/skills/specnaut/SKILL.md")), true);
    assertEquals(
      await exists(join(root, ".agents/skills/specnaut/phases/plan.md")),
      true,
    );
    assertEquals(await exists(join(root, ".agents/skills/specnaut-board/SKILL.md")), true);
    // #409: the deprecated specnaut-auto alias no longer scaffolds.
    assertEquals(await exists(join(root, ".agents/skills/specnaut-auto/SKILL.md")), false);
    // Old per-phase folders are gone post-consolidation.
    assertEquals(
      await exists(join(root, ".agents/skills/specnaut-plan/SKILL.md")),
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
    // The bundled product-owner declares `model: opus` + `effort: high`, which
    // map onto Codex's own two axes: the capability tier picks the model, the
    // effort passes through verbatim.
    assertEquals(parsed.model, "gpt-5.6-sol");
    assertEquals(parsed.model_reasoning_effort, "high");

    // cli#681: `.codex/AGENTS.md` is a relative link to the root AGENTS.md —
    // Codex reads the root file itself; the link is for symmetry and tooling.
    // `.codex/goal.md` is retired: Codex's `/goal` reads no file.
    assertEquals((await Deno.lstat(join(root, ".codex/AGENTS.md"))).isSymlink, true);
    assertEquals(await Deno.readLink(join(root, ".codex/AGENTS.md")), "../AGENTS.md");
    assertEquals(await exists(join(root, ".codex/goal.md")), false);
    const agentsMd = await Deno.readTextFile(join(root, "AGENTS.md"));
    assertEquals(agentsMd.includes("**Codex only:**"), true);
    assertEquals(agentsMd.includes("`/goal <objective>`"), true);
    assertEquals(agentsMd.includes(".claude/"), false);

    // Top-level skill folders post-consolidation: specnaut router +
    // specnaut-board + 5 output-contract skills (#378 + #445:
    // workflow-contract, handoff-protocol, review-findings-contract,
    // qa-report-contract, backlog-reference-contract) + code-audit (#379) + 5 per-axis audit skills
    // (#380: arch-audit, sec-audit, perf-audit, dep-audit, a11y-audit) +
    // status-audit (#381), and since then mobile-first-contract (#576),
    // response-style-contract (#575), specnaut-facts, alert-triage-contract and
    // backlog-frontmatter (#562).
    //
    // The running tally this comment used to carry said 21 next to an assertion
    // of 25 — it had been stale for four features, because nothing checks a
    // comment. Do not restore it: the number below is the fact, and the list
    // above is history. Bump the number when a skill is added, and say which.
    // Phase documents land under specnaut/phases/, not as top-level skills.
    // code-audit's scope script ships under
    // .specnaut/scripts/code-audit/, not as a skill folder; status-audit's
    // schema doc ships to .specnaut/logs/README.md, also not a skill folder.
    const agentsSkillsCount = (await Array.fromAsync(
      Deno.readDir(join(root, ".agents/skills")),
    )).length;
    // 27 since spec 033 (/ship is a top-level skill folder; its documents live
    // inside it). 20 since spec 034 retired seven skills.
    assertEquals(agentsSkillsCount, 20);
    const codexAgentsCount = (await Array.fromAsync(
      Deno.readDir(join(root, ".codex/agents")),
    )).length;
    // 11 original + performance-expert (#304) + accessibility-expert (#305) +
    // architect-expert (#321) + dependency-expert (#322) = 15.
    assertEquals(codexAgentsCount, 15);

    // Shared (cross-harness)
    assertEquals(await exists(join(root, ".specnaut/memory/constitution.md")), true);
    assertEquals(await exists(join(root, "AGENTS.md")), true);
    assertEquals(await exists(join(root, "tasks/backlog.md")), false);
    // These inits take the DEFAULT backend, which is `cloud` — so there is no
    // `.specnaut/backlog/NNN-slug.md` tree for this file to index. It shipped
    // anyway until #525, giving every non-local project a second, empty source
    // of truth for data that lives elsewhere. See init_backlog_test.ts for the
    // local case, where it belongs.
    assertEquals(await exists(join(root, ".specnaut/backlog.md")), false);

    // NOT emitted for codex
    assertEquals(await exists(join(root, ".claude/")), false);
    assertEquals(await exists(join(root, ".cursor/")), false);
    assertEquals(await exists(join(root, "CLAUDE.md")), false);

    // Lock reflects codex
    const lock = await Deno.readTextFile(join(root, ".specnaut/installed.lock"));
    assertEquals(lock.includes("harness: codex"), true);
  });
});
