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

    // v1.0.0: backlog command remains as a flat workflow.
    assertEquals(
      await exists(join(root, ".agent/workflows/backlog.md")),
      true,
    );
    // Per-phase command workflows are gone post-consolidation.
    assertEquals(
      await exists(join(root, ".agent/workflows/specnaut-specify.md")),
      false,
    );

    // Consolidated router skill + phase docs in .agent/skills/specnaut/.
    assertEquals(
      await exists(join(root, ".agent/skills/specnaut/SKILL.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".agent/skills/specnaut/phases/specify.md")),
      true,
    );
    // #409: the deprecated specnaut-auto alias no longer scaffolds.
    assertEquals(
      await exists(join(root, ".agent/skills/specnaut-auto/SKILL.md")),
      false,
    );

    // Agents are flat .md files with the specnaut- prefix; passthrough
    // frontmatter (no permission-map translation).
    assertEquals(
      await exists(join(root, ".agent/agents/specnaut-product-owner.md")),
      true,
    );
    const agentContent = await Deno.readTextFile(
      join(root, ".agent/agents/specnaut-product-owner.md"),
    );
    assertEquals(agentContent.includes("name: specnaut-product-owner"), true);
    assertEquals(agentContent.includes("description:"), true);

    // Shared (cross-harness) project metadata still emitted.
    assertEquals(await exists(join(root, ".specnaut/memory/constitution.md")), true);
    assertEquals(await exists(join(root, "AGENTS.md")), true);
    assertEquals(await exists(join(root, "tasks/backlog.md")), false);
    assertEquals(await exists(join(root, ".specnaut/backlog.md")), true);

    // No other harnesses' output trees.
    assertEquals(await exists(join(root, ".claude/")), false);
    assertEquals(await exists(join(root, ".cursor/")), false);
    assertEquals(await exists(join(root, ".codex/")), false);
    assertEquals(await exists(join(root, ".opencode/")), false);
    assertEquals(await exists(join(root, ".agents/")), false); // OpenCode (plural)
    assertEquals(await exists(join(root, "CLAUDE.md")), false);

    // Lock reflects antigravity.
    const lock = await Deno.readTextFile(join(root, ".specnaut/installed.lock"));
    assertEquals(lock.includes("harness: antigravity"), true);
  });
});
