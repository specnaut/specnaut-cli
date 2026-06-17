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
  const dir = await Deno.makeTempDir({ prefix: "specnaut-init-cursor-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("specnaut init --ai cursor scaffolds a Cursor layout", async () => {
  await withTempDir(async (parent) => {
    const { code, stderr } = await runSpecnaut(
      ["init", "demo", "--no-git", "--ai", "cursor"],
      { cwd: parent },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);

    const root = join(parent, "demo");
    // Cursor-specific (v1.0.0 consolidated layout)
    assertEquals(await exists(join(root, ".cursor/skills/specnaut/SKILL.md")), true);
    assertEquals(
      await exists(join(root, ".cursor/skills/specnaut/phases/specify.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".cursor/skills/specnaut-agent-product-owner/SKILL.md")),
      true,
    );
    assertEquals(await exists(join(root, ".cursor/skills/specnaut-auto/SKILL.md")), true);
    assertEquals(await exists(join(root, ".cursor/rules/specify-rules.mdc")), true);
    // Old per-phase folders are gone post-consolidation.
    assertEquals(
      await exists(join(root, ".cursor/skills/specnaut-specify/SKILL.md")),
      false,
    );

    // Shared
    assertEquals(await exists(join(root, ".specnaut/memory/constitution.md")), true);
    assertEquals(await exists(join(root, "AGENTS.md")), true);
    assertEquals(await exists(join(root, "tasks/backlog.md")), false);
    assertEquals(await exists(join(root, ".specnaut/backlog.md")), true);
    // NOT emitted for cursor
    assertEquals(await exists(join(root, ".claude/")), false);
    assertEquals(await exists(join(root, "CLAUDE.md")), false);

    // Lock reflects cursor
    const lock = await Deno.readTextFile(join(root, ".specnaut/installed.lock"));
    assertEquals(lock.includes("harness: cursor"), true);
  });
});

Deno.test("specnaut init (no --ai) defaults to Claude in non-TTY environments", async () => {
  // Deno.Command pipes stdin, so Deno.stdin.isTerminal() is false here.
  // The init handler must therefore skip the interactive harness picker
  // and fall through to the default — preserving CI / scripted usage.
  await withTempDir(async (parent) => {
    const { code } = await runSpecnaut(["init", "demo", "--no-git"], { cwd: parent });
    assertEquals(code, 0);
    const root = join(parent, "demo");
    assertEquals(await exists(join(root, ".claude/")), true);
    assertEquals(await exists(join(root, ".claude/CLAUDE.md")), true);
    assertEquals(await exists(join(root, "CLAUDE.md")), false);
    assertEquals(await exists(join(root, ".cursor/")), false);
  });
});
