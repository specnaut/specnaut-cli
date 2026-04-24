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
  const dir = await Deno.makeTempDir({ prefix: "specflow-init-force-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test(
  "init --force overwrites a pre-existing .claude/ and creates .specflow.bak files",
  async () => {
    await withTempDir(async (dir) => {
      // Pre-seed a custom .claude/commands/speckit.specify.md so init conflicts without --force
      await Deno.mkdir(join(dir, "demo/.claude/commands"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, "demo/.claude/commands/speckit.specify.md"),
        "CUSTOM CONTENT FROM USER",
      );

      // Without --force: expect exit 3 (conflict).
      const before = await runSpecflow(["init", "demo", "--no-git"], {
        cwd: dir,
      });
      assertEquals(before.code, 3);

      // With --force: expect exit 0 and backup present.
      const after = await runSpecflow(
        ["init", "demo", "--no-git", "--force"],
        { cwd: dir },
      );
      assertEquals(after.code, 0);

      const bakPath = join(
        dir,
        "demo/.claude/commands/speckit.specify.md.specflow.bak",
      );
      const bakContent = await Deno.readTextFile(bakPath);
      assertEquals(bakContent, "CUSTOM CONTENT FROM USER");

      const newContent = await Deno.readTextFile(
        join(dir, "demo/.claude/commands/speckit.specify.md"),
      );
      assertEquals(newContent.includes("CUSTOM CONTENT"), false);

      assertEquals(await exists(join(dir, "demo/AGENTS.md")), true);
      assertEquals(
        await exists(join(dir, "demo/.specify/memory/constitution.md")),
        true,
      );
    });
  },
);
