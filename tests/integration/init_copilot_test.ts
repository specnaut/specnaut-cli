import { assertEquals } from "@std/assert";
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
  const dir = await Deno.makeTempDir({ prefix: "specflow-init-copilot-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("specflow init --ai copilot scaffolds a Copilot layout", async () => {
  await withTempDir(async (parent) => {
    const { code, stderr } = await runSpecflow(
      ["init", "demo", "--no-git", "--ai", "copilot"],
      { cwd: parent },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);

    const root = join(parent, "demo");

    // v1.0.0: router instruction + 11 phase instructions + specflow-auto +
    // specflow-review + backlog + 9 agent instructions.
    assertEquals(
      await exists(join(root, ".github/instructions/specflow.instructions.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".github/instructions/specflow-specify.instructions.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".github/instructions/specflow-backlog.instructions.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".github/instructions/specflow-auto.instructions.md")),
      true,
    );
    assertEquals(
      await exists(
        join(root, ".github/instructions/specflow-agent-product-owner.instructions.md"),
      ),
      true,
    );

    // Frontmatter rewritten — applyTo: "**" present, Claude fields stripped
    const cmdContent = await Deno.readTextFile(
      join(root, ".github/instructions/specflow.instructions.md"),
    );
    assertEquals(cmdContent.includes('applyTo: "**"'), true);
    assertEquals(cmdContent.includes("model: opus"), false);
    assertEquals(cmdContent.includes("tools:"), false);

    // Router + 15 phases (11 original + tag-version + release-version +
    // auto-chain + list-skills) + specflow-auto + specflow-review +
    // writing-plans (#271) + backlog + 11 agents = 30.
    const instructionsCount = (await Array.fromAsync(
      Deno.readDir(join(root, ".github/instructions")),
    )).length;
    assertEquals(instructionsCount, 30);

    // Shared (cross-harness)
    assertEquals(await exists(join(root, ".specflow/memory/constitution.md")), true);
    assertEquals(await exists(join(root, "AGENTS.md")), true);
    assertEquals(await exists(join(root, "tasks/backlog.md")), false);
    assertEquals(await exists(join(root, ".specflow/backlog.md")), true);

    // NOT emitted for copilot
    assertEquals(await exists(join(root, ".claude/")), false);
    assertEquals(await exists(join(root, ".cursor/")), false);
    assertEquals(await exists(join(root, ".agents/")), false);
    assertEquals(await exists(join(root, ".codex/")), false);
    assertEquals(await exists(join(root, ".gemini/")), false);
    assertEquals(await exists(join(root, ".windsurf/")), false);
    assertEquals(await exists(join(root, "CLAUDE.md")), false);

    // Lock reflects copilot
    const lock = await Deno.readTextFile(join(root, ".specflow/installed.lock"));
    assertEquals(lock.includes("harness: copilot"), true);
  });
});
