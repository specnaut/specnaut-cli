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
    assertEquals(await exists(join(root, "tasks/backlog.md")), false);
    assertEquals(await exists(join(root, ".specflow/backlog.md")), true);
    assertEquals(await exists(join(root, ".specflow/memory/constitution.md")), true);
    assertEquals(await exists(join(root, ".specflow/templates/spec-template.md")), true);
    // specflow.* commands now scaffold as skill folders (#76).
    assertEquals(
      await exists(join(root, ".claude/skills/specflow.specify/SKILL.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".claude/skills/specflow.review/SKILL.md")),
      true,
    );
    // The /backlog command (different category) keeps the flat-file format.
    assertEquals(await exists(join(root, ".claude/commands/backlog.md")), true);
    assertEquals(await exists(join(root, ".claude/agents/product-owner.md")), true);
    assertEquals(await exists(join(root, ".claude/agents/devops-sre.md")), true);
    assertEquals(await exists(join(root, ".claude/skills/auto-chain/SKILL.md")), true);

    // Only the backlog command stays in .claude/commands/
    const commandsCount = (await Array.fromAsync(
      Deno.readDir(join(root, ".claude/commands")),
    )).length;
    assertEquals(commandsCount, 1);
    // 9 agent .md files + 5 memory subfolders (product-owner, developer,
    // qa-tester, devops-sre, security-auditor)
    const agentDirEntries = await Array.fromAsync(
      Deno.readDir(join(root, ".claude/agents")),
    );
    const agentMdCount = agentDirEntries.filter((e) => e.isFile && e.name.endsWith(".md")).length;
    assertEquals(agentMdCount, 9);
    const memoryDirCount = agentDirEntries.filter((e) => e.isDirectory).length;
    assertEquals(memoryDirCount, 5);
    // Spot-check one memory file
    assertEquals(
      await exists(join(root, ".claude/agents/product-owner/memory/MEMORY.md")),
      true,
    );
  });
});

async function* walkFiles(root: string): AsyncIterable<string> {
  for await (const entry of Deno.readDir(root)) {
    const full = join(root, entry.name);
    if (entry.isDirectory) {
      yield* walkFiles(full);
    } else if (entry.isFile) {
      yield full;
    }
  }
}

Deno.test("no scaffolded file references the legacy tasks/backlog path", async () => {
  // Drift guard: PR #45 moved the local Markdown backlog under .specflow/.
  // Several harness-static templates kept hardcoded `tasks/backlog.md`
  // strings on the v0.9.0 release; this test ensures every harness's
  // scaffolded output stays consistent on any future template edit.
  for (const harness of ["claude", "cursor", "codex", "gemini"] as const) {
    await withTempDir(async (parent) => {
      const { code } = await runSpecflow(
        ["init", "demo", "--no-git", "--ai", harness],
        { cwd: parent },
      );
      assertEquals(code, 0);
      const root = join(parent, "demo");
      for await (const path of walkFiles(root)) {
        // The lock file legitimately tracks paths; only flag content drift
        // in user-facing prompt / rule / workflow files.
        if (path.endsWith(".specflow/installed.lock")) continue;
        const content = await Deno.readTextFile(path);
        assertEquals(
          content.includes("tasks/backlog"),
          false,
          `${path} (harness=${harness}) still references the legacy tasks/backlog path`,
        );
      }
    });
  }
});

Deno.test("scaffolded product-owner agent documents epic / sub-task support", async () => {
  await withTempDir(async (dir) => {
    const { code } = await runSpecflow(["init", "demo", "--no-git"], { cwd: dir });
    assertEquals(code, 0);
    const po = await Deno.readTextFile(
      join(dir, "demo/.claude/agents/product-owner.md"),
    );
    // Epic concept is documented for both backends.
    assertStringIncludes(po, "Epic concept");
    assertStringIncludes(po, "sub_issues"); // GitHub native sub-issues API
    assertStringIncludes(po, 'parent: "#NNN"'); // local Markdown convention
    // Path move from #45 carried through here too.
    assertStringIncludes(po, ".specflow/backlog.md");
    // The dead sync flow is fully scrubbed from the scaffolded agent.
    assertEquals(po.includes("specflow backlog sync"), false);
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
    // specflow.specify now scaffolds as a skill folder (.claude/skills/...).
    await Deno.mkdir(join(dir, "demo/.claude/skills/specflow.specify"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(dir, "demo/.claude/skills/specflow.specify/SKILL.md"),
      "custom",
    );
    const { code, stderr } = await runSpecflow(["init", "demo", "--no-git"], { cwd: dir });
    assertEquals(code, 3);
    assertStringIncludes(stderr, ".claude/skills/specflow.specify/SKILL.md");
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
