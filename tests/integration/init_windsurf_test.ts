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
  const dir = await Deno.makeTempDir({ prefix: "specflow-init-windsurf-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("specflow init --ai windsurf scaffolds a Windsurf layout", async () => {
  await withTempDir(async (parent) => {
    const { code, stderr } = await runSpecflow(
      ["init", "demo", "--no-git", "--ai", "windsurf"],
      { cwd: parent },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);

    const root = join(parent, "demo");

    // v1.0.0: router workflow + 11 sibling phase workflows + specflow-auto +
    // specflow-review alias + backlog + 9 agent workflows.
    assertEquals(
      await exists(join(root, ".windsurf/workflows/specflow.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".windsurf/workflows/specflow-specify.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".windsurf/workflows/specflow-backlog.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".windsurf/workflows/specflow-auto.md")),
      true,
    );
    assertEquals(
      await exists(
        join(root, ".windsurf/workflows/specflow-agent-product-owner.md"),
      ),
      true,
    );

    // Router + 11 phases + specflow-auto + specflow-review alias + backlog +
    // 9 agent workflows = 23.
    const workflowsCount = (await Array.fromAsync(
      Deno.readDir(join(root, ".windsurf/workflows")),
    )).length;
    assertEquals(workflowsCount, 23);

    // Shared (cross-harness)
    assertEquals(await exists(join(root, ".specflow/memory/constitution.md")), true);
    assertEquals(await exists(join(root, "AGENTS.md")), true);
    assertEquals(await exists(join(root, "tasks/backlog.md")), false);
    assertEquals(await exists(join(root, ".specflow/backlog.md")), true);

    // NOT emitted for windsurf
    assertEquals(await exists(join(root, ".claude/")), false);
    assertEquals(await exists(join(root, ".cursor/")), false);
    assertEquals(await exists(join(root, ".agents/")), false);
    assertEquals(await exists(join(root, ".codex/")), false);
    assertEquals(await exists(join(root, ".gemini/")), false);
    assertEquals(await exists(join(root, "CLAUDE.md")), false);

    // Lock reflects windsurf
    const lock = await Deno.readTextFile(join(root, ".specflow/installed.lock"));
    assertEquals(lock.includes("harness: windsurf"), true);
  });
});
