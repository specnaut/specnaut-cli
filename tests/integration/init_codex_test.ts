import { assert, assertEquals } from "@std/assert";
import { exists } from "@std/fs/exists";
import { parse as parseToml } from "@std/toml";
import { fromFileUrl, join } from "@std/path";
import { readLinkText } from "../helpers/link_text.ts";

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
      await exists(join(root, ".agents/skills/specnaut-task/phases/plan.md")),
      true,
    );
    assertEquals(await exists(join(root, ".agents/skills/specnaut-task/SKILL.md")), true);
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
    // The bundled product-owner declares `model: opus` + `effort: high`. No model
    // version is pinned (cli#707): the family is a comment, the effort is verbatim.
    assertEquals("model" in parsed, false);
    assert(tomlContent.startsWith("# Model family: Sol (opus on Claude Code)\n"));
    assertEquals(parsed.model_reasoning_effort, "high");

    // cli#681: `.codex/AGENTS.md` is a relative link to the root AGENTS.md —
    // Codex reads the root file itself; the link is for symmetry and tooling.
    // `.codex/goal.md` is retired: Codex's `/goal` reads no file.
    assertEquals((await Deno.lstat(join(root, ".codex/AGENTS.md"))).isSymlink, true);
    assertEquals(await readLinkText(join(root, ".codex/AGENTS.md")), "../AGENTS.md");
    assertEquals(await exists(join(root, ".codex/goal.md")), false);
    const agentsMd = await Deno.readTextFile(join(root, "AGENTS.md"));
    // cli#679: one pointer line; the reference sits beside the specnaut-facts skill.
    assertEquals(agentsMd.includes("`.agents/skills/specnaut-facts/integrations.md`"), true);
    const integrations = await Deno.readTextFile(
      join(root, ".agents/skills/specnaut-facts/integrations.md"),
    );
    assertEquals(integrations.includes("## Codex"), true);
    assertEquals(integrations.includes("`/goal <objective>`"), true);
    assertEquals(agentsMd.includes(".claude/"), false);

    // Top-level skill folders post-consolidation: specnaut router +
    // specnaut-task + 5 output-contract skills (#378 + #445:
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
    // Phase documents land under specnaut-task/phases/, not as top-level skills.
    // The audit scope script ships under
    // .specnaut/scripts/audit/, not as a skill folder; status-audit's
    // schema doc ships to .specnaut/logs/README.md and its reporter to
    // .specnaut/scripts/status/ (cli#679), neither a skill folder.
    const agentsSkillsCount = (await Array.fromAsync(
      Deno.readDir(join(root, ".agents/skills")),
    )).length;
    // 27 since spec 033 (/ship is a top-level skill folder; its documents live
    // inside it). 20 since spec 034 retired seven skills. 14 since cli#683:
    // `board`, `code-audit` and the five `*-audit` skills became `specnaut-task`.
    // 11 since #678 retired handoff-protocol, qa-report-contract and
    // alert-triage-contract — blocks nothing parsed, a mode nothing dispatched.
    // 12 since #678 turned ui-ux-designer into `specnaut-design`.
    assertEquals(agentsSkillsCount, 12);
    assertEquals(await exists(join(root, ".agents/skills/specnaut-design/SKILL.md")), true);
    for (
      const retired of [
        "specnaut-board",
        "specnaut-code-audit",
        "specnaut-sec-audit",
        "specnaut-handoff-protocol",
        "specnaut-qa-report-contract",
        "specnaut-alert-triage-contract",
      ]
    ) {
      assertEquals(
        await exists(join(root, ".agents/skills", retired)),
        false,
        `${retired} is retired`,
      );
    }
    const codexAgentsCount = (await Array.fromAsync(
      Deno.readDir(join(root, ".codex/agents")),
    )).length;
    // 11 original + performance-expert (#304) + accessibility-expert (#305) +
    // architect-expert (#321) + dependency-expert (#322), less
    // review-coordinator, test-reviewer, workflow-manager, qa-tester and
    // devops-sre (#678) = 10, less ui-ux-designer (now the /design skill) = 9.
    assertEquals(codexAgentsCount, 9);
    for (const retired of ["workflow-manager", "qa-tester", "devops-sre", "ui-ux-designer"]) {
      assertEquals(await exists(join(root, `.codex/agents/${retired}.toml`)), false);
    }
    // cli#679: the status-audit reporter lands where the Codex skill runs it.
    const statusAudit = ".specnaut/scripts/status/status-audit.sh";
    assertEquals(await exists(join(root, statusAudit)), true);
    const statusSkill = join(root, ".agents/skills/specnaut-status-audit/SKILL.md");
    assertEquals((await Deno.readTextFile(statusSkill)).includes(`bash ${statusAudit}`), true);

    // Shared (cross-harness)
    assertEquals(await exists(join(root, "docs/constitution.md")), true);
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

// spec 036: the guards are installed once, at `.specnaut/hooks/`, and Codex
// learns of them only through `.codex/hooks.json` — a JSON merge, so the user's
// own registrations in that file survive the init.
Deno.test("specnaut init --ai codex installs the guards and merges them into .codex/hooks.json", async () => {
  await withTempDir(async (root) => {
    const own = { type: "command", command: "./tools/acme-check.sh" };
    await Deno.mkdir(join(root, ".codex"), { recursive: true });
    await Deno.writeTextFile(
      join(root, ".codex/hooks.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [own] }] } }, null, 2),
    );
    const { code, stdout, stderr } = await runSpecnaut(
      ["init", "--here", "--no-git", "--ai", "codex", "--backlog", "local"],
      { cwd: root },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);
    assertEquals(stdout.includes(".codex/hooks.json"), true, "hooks.json is not reported merged");

    const guard = await Deno.stat(join(root, ".specnaut/hooks/guard-merge.sh"));
    assertEquals(guard.isFile, true);
    // Windows has no POSIX mode (Deno reports none): nothing to assert there, and
    // nothing lost — every registration runs the guard as `bash <script>`.
    if (Deno.build.os !== "windows") {
      assertEquals((guard.mode ?? 0) & 0o111, 0o111, "guard-merge.sh is not executable");
    }

    const hooks = JSON.parse(await Deno.readTextFile(join(root, ".codex/hooks.json"))).hooks;
    const commands: string[] = Object.values(hooks).flatMap((groups) =>
      (groups as Array<{ hooks: Array<{ command: string }> }>).flatMap((g) =>
        g.hooks.map((h) => h.command)
      )
    );
    assertEquals(commands.filter((c) => c === own.command).length, 1, "the user's hook was lost");
    const scripts = commands.flatMap((c) => [...c.matchAll(/\.specnaut\/hooks\/([\w-]+\.sh)/g)])
      .map((m) => m[1]);
    assertEquals(scripts.includes("guard-merge.sh"), true, JSON.stringify(commands));
    for (const script of scripts) {
      assertEquals(await exists(join(root, ".specnaut/hooks", script)), true, `${script} missing`);
    }
    // A merged file is the user's: never lock-tracked.
    const lock = await Deno.readTextFile(join(root, ".specnaut/installed.lock"));
    assertEquals(lock.includes(".codex/hooks.json"), false);
  });
});
