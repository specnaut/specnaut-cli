import { assertEquals, assertStringIncludes } from "@std/assert";
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
  const dir = await Deno.makeTempDir({ prefix: "specflow-integ-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("specflow init <name> writes a complete tree", async () => {
  await withTempDir(async (dir) => {
    const { code, stderr } = await runSpecflow(["init", "demo", "--no-git"], { cwd: dir });
    assertEquals(code, 0, `init failed: ${stderr}`);

    const root = join(dir, "demo");
    assertEquals(await exists(join(root, ".claude/CLAUDE.md")), true);
    assertEquals(await exists(join(root, "CLAUDE.md")), false);
    assertEquals(await exists(join(root, "AGENTS.md")), true);
    assertEquals(await exists(join(root, "tasks/backlog.md")), true);
    assertEquals(await exists(join(root, ".specflow/memory/constitution.md")), true);
    assertEquals(await exists(join(root, ".specflow/templates/spec-template.md")), true);
    assertEquals(await exists(join(root, ".claude/commands/specflow.specify.md")), true);
    assertEquals(await exists(join(root, ".claude/commands/specflow.review.md")), true);
    assertEquals(await exists(join(root, ".claude/commands/backlog.md")), true);
    assertEquals(await exists(join(root, ".claude/agents/product-owner.md")), true);
    assertEquals(await exists(join(root, ".claude/agents/devops-sre.md")), true);
    assertEquals(await exists(join(root, ".claude/skills/auto-chain/SKILL.md")), true);

    const commandsCount = (await Array.fromAsync(
      Deno.readDir(join(root, ".claude/commands")),
    )).length;
    assertEquals(commandsCount, 11);
    const agentsCount = (await Array.fromAsync(
      Deno.readDir(join(root, ".claude/agents")),
    )).length;
    assertEquals(agentsCount, 9);
  });
});

Deno.test("specflow init's Next steps nudges towards /specflow.constitution first", async () => {
  await withTempDir(async (dir) => {
    const { code, stdout } = await runSpecflow(["init", "demo", "--no-git"], { cwd: dir });
    assertEquals(code, 0);
    assertStringIncludes(stdout, "Next steps:");
    assertStringIncludes(stdout, "/specflow.constitution");
    // The constitution step must come before /specflow.specify in the rendered list.
    const constitutionIdx = stdout.indexOf("/specflow.constitution");
    const specifyIdx = stdout.indexOf("/specflow.specify");
    assertEquals(
      constitutionIdx > 0 && constitutionIdx < specifyIdx,
      true,
      "constitution step must precede specify step in Next steps",
    );
  });
});

Deno.test("specflow init --here writes into cwd", async () => {
  await withTempDir(async (dir) => {
    const { code, stderr } = await runSpecflow(["init", "--here", "--no-git"], { cwd: dir });
    assertEquals(code, 0, `init --here failed: ${stderr}`);
    assertEquals(await exists(join(dir, ".claude/CLAUDE.md")), true);
    assertEquals(await exists(join(dir, "CLAUDE.md")), false);
  });
});

Deno.test("specflow init refuses to overwrite a pre-existing .claude/", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, "demo/.claude/commands"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "demo/.claude/commands/specflow.specify.md"),
      "custom",
    );
    const { code, stderr } = await runSpecflow(["init", "demo", "--no-git"], { cwd: dir });
    assertEquals(code, 3);
    assertStringIncludes(stderr, ".claude/commands/specflow.specify.md");
    assertStringIncludes(stderr, "specflow init --here --force");
    assertStringIncludes(stderr, "specflow upgrade");
    assertEquals(stderr.includes("v0.1"), false, "error message must not hardcode a version");
  });
});

Deno.test("specflow --version prints semver line", async () => {
  const { code, stdout } = await runSpecflow(["--version"]);
  assertEquals(code, 0);
  assertStringIncludes(stdout, "specflow ");
  assertStringIncludes(stdout, "templates ");
});

Deno.test("specflow -v matches --version", async () => {
  const long = await runSpecflow(["--version"]);
  const short = await runSpecflow(["-v"]);
  assertEquals(short.code, 0);
  assertEquals(short.stdout, long.stdout);
});

Deno.test("specflow --help prints usage", async () => {
  const { code, stdout } = await runSpecflow(["--help"]);
  assertEquals(code, 0);
  assertStringIncludes(stdout, "Usage:");
  assertStringIncludes(stdout, "specflow init");
});

Deno.test("specflow -h matches --help", async () => {
  const long = await runSpecflow(["--help"]);
  const short = await runSpecflow(["-h"]);
  assertEquals(short.code, 0);
  assertEquals(short.stdout, long.stdout);
});

Deno.test("specflow --help advertises -v and -h shortcuts", async () => {
  const { stdout } = await runSpecflow(["--help"]);
  assertStringIncludes(stdout, "--version, -v");
  assertStringIncludes(stdout, "--help, -h");
});

Deno.test("specflow --help tagline does not mention spec-kit", async () => {
  const { stdout } = await runSpecflow(["--help"]);
  assertStringIncludes(stdout, "AI project scaffolding CLI");
  assertEquals(
    stdout.toLowerCase().includes("spec-kit"),
    false,
    "help tagline must not mention spec-kit (lineage belongs in README/AGENTS.md)",
  );
});

Deno.test("specflow bogus returns exit code 2", async () => {
  const { code } = await runSpecflow(["bogus"]);
  assertEquals(code, 2);
});
