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
  const dir = await Deno.makeTempDir({ prefix: "specflow-init-cursor-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("specflow init --ai cursor scaffolds a Cursor layout", async () => {
  await withTempDir(async (parent) => {
    const { code, stderr } = await runSpecflow(
      ["init", "demo", "--no-git", "--ai", "cursor"],
      { cwd: parent },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);

    const root = join(parent, "demo");
    // Cursor-specific
    assertEquals(await exists(join(root, ".cursor/skills/specflow-specify/SKILL.md")), true);
    assertEquals(
      await exists(join(root, ".cursor/skills/specflow-agent-product-owner/SKILL.md")),
      true,
    );
    assertEquals(await exists(join(root, ".cursor/skills/specflow-speckit/SKILL.md")), true);
    assertEquals(await exists(join(root, ".cursor/rules/specify-rules.mdc")), true);

    const skillsCount = (await Array.fromAsync(
      Deno.readDir(join(root, ".cursor/skills")),
    )).length;
    assertEquals(skillsCount, 20);

    // Shared
    assertEquals(await exists(join(root, ".specflow/memory/constitution.md")), true);
    assertEquals(await exists(join(root, "AGENTS.md")), true);
    assertEquals(await exists(join(root, "tasks/backlog.md")), true);
    // NOT emitted for cursor
    assertEquals(await exists(join(root, ".claude/")), false);
    assertEquals(await exists(join(root, "CLAUDE.md")), false);

    // Lock reflects cursor
    const lock = await Deno.readTextFile(join(root, ".specflow/installed.lock"));
    assertEquals(lock.includes("harness: cursor"), true);
  });
});

Deno.test("specflow init (no --ai) still defaults to Claude", async () => {
  await withTempDir(async (parent) => {
    const { code } = await runSpecflow(["init", "demo", "--no-git"], { cwd: parent });
    assertEquals(code, 0);
    const root = join(parent, "demo");
    assertEquals(await exists(join(root, ".claude/")), true);
    assertEquals(await exists(join(root, "CLAUDE.md")), true);
    assertEquals(await exists(join(root, ".cursor/")), false);
  });
});
