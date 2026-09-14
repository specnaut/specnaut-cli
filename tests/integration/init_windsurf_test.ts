import { assertEquals } from "@std/assert";
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
  const dir = await Deno.makeTempDir({ prefix: "specnaut-init-windsurf-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("specnaut init --ai windsurf scaffolds a Windsurf layout", async () => {
  await withTempDir(async (parent) => {
    const { code, stderr } = await runSpecnaut(
      ["init", "demo", "--no-git", "--ai", "windsurf"],
      { cwd: parent },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);

    const root = join(parent, "demo");

    // v1.0.0: router workflow + 11 sibling phase workflows +
    // board + 9 agent workflows.
    assertEquals(
      await exists(join(root, ".windsurf/workflows/specnaut.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".windsurf/workflows/specnaut-plan.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".windsurf/workflows/specnaut-board.md")),
      true,
    );
    // #409: the deprecated specnaut-auto alias no longer scaffolds.
    assertEquals(
      await exists(join(root, ".windsurf/workflows/specnaut-auto.md")),
      false,
    );
    assertEquals(
      await exists(
        join(root, ".windsurf/workflows/specnaut-agent-product-owner.md"),
      ),
      true,
    );

    // Router + 17 phases (plan + plan-audits + tasks + implement + review +
    // merge + merge-squash #558 + constitution + groom + tag-version + release-version +
    // auto-chain + audit-security #303 + audit-performance #304 +
    // audit-accessibility #305 + audit-architecture #321 +
    // audit-dependencies #322 — brainstorm/specify/clarify/analyze/checklist/
    // list-skills/lite-heuristic removed in #455) +
    // writing-plans (#271) +
    // requesting-code-review (#273) + using-specnaut (#282) +
    // subagent-driven-development (#272) + executing-plans (#274) +
    // verification-before-completion (#275) + brainstorming (#276) +
    // 5 output-contract skills (#378 + #445: workflow-contract,
    // handoff-protocol, review-findings-contract, qa-report-contract,
    // backlog-reference-contract) + code-audit (#379) +
    // 5 per-axis audit skills (#380: arch-audit, sec-audit, perf-audit,
    // dep-audit, a11y-audit) + status-audit (#381) +
    // board + 15 agent workflows (11 original + performance-expert #304
    // + accessibility-expert #305 + architect-expert #321 + dependency-expert
    // #322) = 54 (specnaut-auto removed in #409; merge-squash #558 + epic-commits #556 + quality-gates #555 + epic-fixups #559 + merge-close #560 + epic-loop #554 added; board spec-autogen + groom-report + 3 seat contracts #562 split out). code-audit's scope script
    // ships under .specnaut/scripts/code-audit/, not as a flattened workflow file;
    // status-audit's schema doc ships to .specnaut/logs/README.md, also not
    // flattened here.
    const workflowsCount = (await Array.fromAsync(
      Deno.readDir(join(root, ".windsurf/workflows")),
    )).length;
    // 66 since spec 033: /ship adds three flat workflows (the skill plus its
    // two documents) and retires two (`specnaut-tag-version`,
    // `specnaut-release-version`) — net +1.
    assertEquals(workflowsCount, 66);

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

    // NOT emitted for windsurf
    assertEquals(await exists(join(root, ".claude/")), false);
    assertEquals(await exists(join(root, ".cursor/")), false);
    assertEquals(await exists(join(root, ".agents/")), false);
    assertEquals(await exists(join(root, ".codex/")), false);
    assertEquals(await exists(join(root, "CLAUDE.md")), false);

    // Lock reflects windsurf
    const lock = await Deno.readTextFile(join(root, ".specnaut/installed.lock"));
    assertEquals(lock.includes("harness: windsurf"), true);
  });
});
