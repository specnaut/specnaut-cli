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
  const dir = await Deno.makeTempDir({ prefix: "specnaut-init-force-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test(
  "init --force overwrites a pre-existing .claude/ and creates .specnaut.bak files",
  async () => {
    await withTempDir(async (dir) => {
      // Pre-seed the consolidated router skill so init conflicts without --force.
      await Deno.mkdir(join(dir, "demo/.claude/skills/specnaut"), {
        recursive: true,
      });
      await Deno.writeTextFile(
        join(dir, "demo/.claude/skills/specnaut/SKILL.md"),
        "CUSTOM CONTENT FROM USER",
      );

      // Without --force: expect exit 3 (conflict).
      const before = await runSpecnaut(["init", "demo", "--no-git"], {
        cwd: dir,
      });
      assertEquals(before.code, 3);

      // With --force: expect exit 0 and backup present.
      const after = await runSpecnaut(
        ["init", "demo", "--no-git", "--force"],
        { cwd: dir },
      );
      assertEquals(after.code, 0);

      const bakPath = join(
        dir,
        "demo/.claude/skills/specnaut/SKILL.md.specnaut.bak",
      );
      const bakContent = await Deno.readTextFile(bakPath);
      assertEquals(bakContent, "CUSTOM CONTENT FROM USER");

      const newContent = await Deno.readTextFile(
        join(dir, "demo/.claude/skills/specnaut/SKILL.md"),
      );
      assertEquals(newContent.includes("CUSTOM CONTENT"), false);

      assertEquals(await exists(join(dir, "demo/AGENTS.md")), true);
      assertEquals(
        await exists(join(dir, "demo/.specnaut/memory/constitution.md")),
        true,
      );
    });
  },
);
