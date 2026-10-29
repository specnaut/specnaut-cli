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
  const dir = await Deno.makeTempDir({ prefix: "specnaut-init-antigravity-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("specnaut init --ai antigravity scaffolds an Antigravity layout", async () => {
  await withTempDir(async (parent) => {
    const { code, stderr } = await runSpecnaut(
      ["init", "demo", "--no-git", "--ai", "antigravity"],
      { cwd: parent },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);

    const root = join(parent, "demo");

    // #533 retired the backlog command shim; the skill registers /task.
    assertEquals(
      await exists(join(root, ".agents/workflows/backlog.md")),
      false,
    );
    // Per-phase command workflows are gone post-consolidation.
    assertEquals(
      await exists(join(root, ".agents/workflows/specnaut-plan.md")),
      false,
    );

    // Consolidated router skill + phase docs in .agent/skills/specnaut/.
    assertEquals(
      await exists(join(root, ".agents/skills/specnaut/SKILL.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".agents/skills/specnaut-task/phases/plan.md")),
      true,
    );
    // #409: the deprecated specnaut-auto alias no longer scaffolds.
    assertEquals(
      await exists(join(root, ".agents/skills/specnaut-auto/SKILL.md")),
      false,
    );

    // Agents are flat .md files with the specnaut- prefix; passthrough
    // frontmatter (no permission-map translation).
    assertEquals(
      await exists(join(root, ".agents/agents/specnaut-product-owner.md")),
      true,
    );
    const agentContent = await Deno.readTextFile(
      join(root, ".agents/agents/specnaut-product-owner.md"),
    );
    assertEquals(agentContent.includes("name: specnaut-product-owner"), true);
    assertEquals(agentContent.includes("description:"), true);
    // Without `subagent: true` Antigravity discovers the file but the primary
    // agent cannot reach it via `invoke_subagent` — a seat that scaffolds and
    // is then undispatchable looks exactly like a working install.
    assertEquals(agentContent.includes("subagent: true"), true);
    // Antigravity's model vocabulary is inherit | flash | pro. The Claude tier
    // is translated, never copied: `model: opus` is a value it cannot read.
    assertEquals(agentContent.includes("model: pro"), true);
    assertEquals(agentContent.includes("model: opus"), false);

    // Shared (cross-harness) project metadata still emitted.
    assertEquals(await exists(join(root, "docs/constitution.md")), true);
    assertEquals(await exists(join(root, "AGENTS.md")), true);
    assertEquals(await exists(join(root, "tasks/backlog.md")), false);
    // These inits take the DEFAULT backend, which is `cloud` — so there is no
    // `.specnaut/backlog/NNN-slug.md` tree for this file to index. It shipped
    // anyway until #525, giving every non-local project a second, empty source
    // of truth for data that lives elsewhere. See init_backlog_test.ts for the
    // local case, where it belongs.
    assertEquals(await exists(join(root, ".specnaut/backlog.md")), false);

    // No other harnesses' output trees.
    assertEquals(await exists(join(root, ".claude/")), false);
    assertEquals(await exists(join(root, ".cursor/")), false);
    assertEquals(await exists(join(root, ".codex/")), false);
    assertEquals(await exists(join(root, ".opencode/")), false);
    // `.agents/` is Antigravity's own tree — asserted present above. This line
    // used to assert it absent, labelled "OpenCode (plural)", which OpenCode
    // has never used: it writes `.opencode/`, checked on the line above. The
    // misattribution is what pinned the wrong output path in place.
    assertEquals(await exists(join(root, "CLAUDE.md")), false);

    // Lock reflects antigravity.
    const lock = await Deno.readTextFile(join(root, ".specnaut/installed.lock"));
    assertEquals(lock.includes("harness: antigravity"), true);
  });
});
