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
    // v1.0.0: 11 phases consolidated into the specflow router skill.
    assertEquals(
      await exists(join(root, ".claude/skills/specflow/SKILL.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".claude/skills/specflow/phases/specify.md")),
      true,
    );
    assertEquals(
      await exists(join(root, ".claude/skills/specflow/phases/groom.md")),
      true,
    );
    // Auto-invoke alias for the review phase.
    assertEquals(
      await exists(join(root, ".claude/skills/specflow-review/SKILL.md")),
      true,
    );
    // Old per-phase folders are gone post-consolidation.
    assertEquals(
      await exists(join(root, ".claude/skills/specflow-specify/SKILL.md")),
      false,
    );
    assertEquals(
      await exists(join(root, ".claude/skills/specflow-groom/SKILL.md")),
      false,
    );
    // The /backlog command keeps the flat-file format. The /specflow
    // command is a thin slash-command shim added post-v1.0.0 so users
    // can type `/specflow specify ...` literally (Claude-only — see F3).
    assertEquals(await exists(join(root, ".claude/commands/backlog.md")), true);
    assertEquals(await exists(join(root, ".claude/commands/specflow.md")), true);
    assertEquals(await exists(join(root, ".claude/agents/product-owner.md")), true);
    assertEquals(await exists(join(root, ".claude/agents/devops-sre.md")), true);
    assertEquals(await exists(join(root, ".claude/skills/specflow-auto/SKILL.md")), true);

    // Two commands ship at the moment: backlog + specflow router.
    const commandsCount = (await Array.fromAsync(
      Deno.readDir(join(root, ".claude/commands")),
    )).length;
    assertEquals(commandsCount, 2);
    // 15 agent .md files (11 original + performance-auditor #304 +
    // a11y-auditor #305 + architecture-auditor #321 + dependency-auditor
    // #322) + 5 memory subfolders (product-owner, developer, qa-tester,
    // devops-sre, security-auditor; specflow-expert, ui-ux-designer,
    // performance-auditor, a11y-auditor, architecture-auditor, and
    // dependency-auditor are stateless and ship without a memory stub)
    const agentDirEntries = await Array.fromAsync(
      Deno.readDir(join(root, ".claude/agents")),
    );
    // 15 agent definitions; the agent-fleet README (#382) is a sibling
    // doc, not an agent, so it's excluded from this count and asserted
    // separately below.
    const agentMdCount = agentDirEntries.filter(
      (e) => e.isFile && e.name.endsWith(".md") && e.name !== "README.md",
    ).length;
    assertEquals(agentMdCount, 15);
    const memoryDirCount = agentDirEntries.filter((e) => e.isDirectory).length;
    assertEquals(memoryDirCount, 5);
    // The effort-rubric README ships beside the agents (#382).
    assertEquals(
      await exists(join(root, ".claude/agents/README.md")),
      true,
    );
    // Spot-check one memory file
    assertEquals(
      await exists(join(root, ".claude/agents/product-owner/memory/MEMORY.md")),
      true,
    );
    // Spot-check the new specflow-expert agent
    assertEquals(
      await exists(join(root, ".claude/agents/specflow-expert.md")),
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
  for (const harness of ["claude", "cursor", "codex"] as const) {
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

Deno.test("specflow init's Next steps nudges towards /specflow-constitution first", async () => {
  await withTempDir(async (dir) => {
    const { code, stdout } = await runSpecflow(["init", "demo", "--no-git"], { cwd: dir });
    assertEquals(code, 0);
    assertStringIncludes(stdout, "Next steps:");
    assertStringIncludes(stdout, "/specflow constitution");
    // The constitution step must come before /specflow specify in the rendered list.
    const constitutionIdx = stdout.indexOf("/specflow constitution");
    const specifyIdx = stdout.indexOf("/specflow specify");
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

Deno.test("specflow init on a fresh project recommends --force (no lock present)", async () => {
  await withTempDir(async (dir) => {
    // Pre-seed a managed file (the router skill) to force a conflict.
    await Deno.mkdir(join(dir, "demo/.claude/skills/specflow"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(dir, "demo/.claude/skills/specflow/SKILL.md"),
      "custom",
    );
    const { code, stderr } = await runSpecflow(["init", "demo", "--no-git"], { cwd: dir });
    assertEquals(code, 3);
    assertStringIncludes(stderr, ".claude/skills/specflow/SKILL.md");
    assertStringIncludes(stderr, "would be overwritten");
    assertStringIncludes(stderr, "specflow init --here --force");
    assertEquals(
      stderr.includes("specflow upgrade"),
      false,
      "must not suggest upgrade when no lock is present",
    );
    assertEquals(stderr.includes("v0.1"), false, "error message must not hardcode a version");
  });
});

Deno.test("specflow init aborts on conflicts BEFORE prompting for backlog backend (regression #103)", async () => {
  await withTempDir(async (dir) => {
    // Pre-seed a managed file to force a conflict on re-init.
    await Deno.mkdir(join(dir, "demo/.claude/skills/specflow"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(dir, "demo/.claude/skills/specflow/SKILL.md"),
      "custom",
    );
    // Pass --ai claude so the harness picker doesn't fire (it's only the
    // backlog-backend picker we're asserting against). Crucially, we omit
    // --backlog so the backend would normally be resolved interactively.
    const { code, stdout, stderr } = await runSpecflow(
      ["init", "demo", "--no-git", "--ai", "claude"],
      { cwd: dir },
    );
    assertEquals(code, 3);
    assertStringIncludes(stderr, "would be overwritten");
    assertEquals(
      stdout.includes("Choose your backlog backend"),
      false,
      "regression #103: backlog-backend picker must not run when init is going to abort on conflicts",
    );
  });
});

Deno.test("specflow init on a previously-initialised project recommends upgrade (lock present)", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, "demo/.claude/skills/specflow"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(dir, "demo/.claude/skills/specflow/SKILL.md"),
      "custom",
    );
    // Drop a stub lock so the conflict path treats this as a re-init.
    await Deno.mkdir(join(dir, "demo/.specflow"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "demo/.specflow/installed.lock"),
      [
        "version: 2",
        "harness: claude",
        "backlog_backend: local",
        "templates_version: 0.0.0",
        "entries: {}",
        "",
      ].join("\n"),
    );
    const { code, stderr } = await runSpecflow(["init", "demo", "--no-git"], { cwd: dir });
    assertEquals(code, 3);
    assertStringIncludes(stderr, "would be overwritten");
    assertStringIncludes(stderr, "specflow upgrade");
    // Post-#129/F4: --force is also offered as an escape hatch (e.g. for
    // switching harness or backlog backend). Both options surface.
    assertStringIncludes(stderr, "specflow init --here --force");
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

// ── Skip-if-exists placeholders (#119) ─────────────────────────────────────

Deno.test("specflow init --here on a project with existing AGENTS.md does NOT error and leaves AGENTS.md untouched", async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, "demo");
    await Deno.mkdir(target, { recursive: true });
    const userAgents = "# My Project\n\nMy own architecture rules.\nLine 3.\n";
    await Deno.writeTextFile(join(target, "AGENTS.md"), userAgents);

    const { code, stderr } = await runSpecflow(
      ["init", "--here", "--no-git", "--ai", "claude", "--backlog", "local"],
      { cwd: target },
    );
    assertEquals(code, 0);
    assertEquals(
      stderr.includes("would be overwritten"),
      false,
      "AGENTS.md should NOT trigger the conflict path",
    );

    // User content preserved verbatim
    const after = await Deno.readTextFile(join(target, "AGENTS.md"));
    assertEquals(after, userAgents);

    // Init succeeded → other Specflow files installed
    assertEquals(await exists(join(target, ".claude/CLAUDE.md")), true);
    assertEquals(await exists(join(target, ".specflow/installed.lock")), true);

    // Lock should NOT track AGENTS.md (it's user-owned)
    const lock = await Deno.readTextFile(
      join(target, ".specflow/installed.lock"),
    );
    assertEquals(
      lock.includes("AGENTS.md"),
      false,
      "skip-if-exists files that pre-existed must not be in the lock",
    );
  });
});

Deno.test("specflow init on a fresh project writes AGENTS.md normally and tracks it in the lock", async () => {
  await withTempDir(async (dir) => {
    const { code } = await runSpecflow(
      ["init", "demo", "--no-git", "--ai", "claude", "--backlog", "local"],
      { cwd: dir },
    );
    assertEquals(code, 0);

    const target = join(dir, "demo");
    const agents = await Deno.readTextFile(join(target, "AGENTS.md"));
    assertStringIncludes(agents, "AGENTS.md — Project Context");

    const lock = await Deno.readTextFile(
      join(target, ".specflow/installed.lock"),
    );
    assertStringIncludes(
      lock,
      "AGENTS.md",
      "fresh-write skip-if-exists files DO get a lock entry",
    );
  });
});

Deno.test("specflow init --here on a project with existing constitution.md leaves it untouched", async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, "demo");
    await Deno.mkdir(join(target, ".specflow/memory"), { recursive: true });
    const userConstitution = "# My Project Constitution\n\nMy own principles.\n";
    await Deno.writeTextFile(
      join(target, ".specflow/memory/constitution.md"),
      userConstitution,
    );

    const { code } = await runSpecflow(
      ["init", "--here", "--no-git", "--ai", "claude", "--backlog", "local"],
      { cwd: target },
    );
    assertEquals(code, 0);

    const after = await Deno.readTextFile(
      join(target, ".specflow/memory/constitution.md"),
    );
    assertEquals(after, userConstitution);
  });
});

// ── Consolidated router skill (v1.0.0) ──────────────────────────────────

Deno.test("specflow init scaffolds the consolidated router skill + 11 phase docs", async () => {
  await withTempDir(async (dir) => {
    const { code } = await runSpecflow(
      ["init", "demo", "--no-git", "--ai", "claude", "--backlog", "local"],
      { cwd: dir },
    );
    assertEquals(code, 0);

    const root = join(dir, "demo");
    assertEquals(
      await exists(join(root, ".claude/skills/specflow/SKILL.md")),
      true,
    );
    for (
      const name of [
        "brainstorm",
        "specify",
        "plan",
        "tasks",
        "implement",
        "analyze",
        "review",
        "merge",
        "constitution",
        "checklist",
        "clarify",
        "groom",
      ]
    ) {
      assertEquals(
        await exists(
          join(root, `.claude/skills/specflow/phases/${name}.md`),
        ),
        true,
        `expected .claude/skills/specflow/phases/${name}.md`,
      );
      // Old per-phase folders are gone post-consolidation.
      // Exception: `specflow-review` is the auto-invoke alias (kept).
      if (name !== "review") {
        assertEquals(
          await exists(join(root, `.claude/skills/specflow-${name}/SKILL.md`)),
          false,
          `legacy per-phase folder must NOT exist`,
        );
      }
    }
    // Old standalone groom skill removed.
    assertEquals(
      await exists(join(root, ".claude/skills/specflow-groom/SKILL.md")),
      false,
    );
    // Auto-invoke alias still ships.
    assertEquals(
      await exists(join(root, ".claude/skills/specflow-review/SKILL.md")),
      true,
    );
    const routerContent = await Deno.readTextFile(
      join(root, ".claude/skills/specflow/SKILL.md"),
    );
    assertStringIncludes(routerContent, "name: specflow");
    // The router must NOT carry `disable-model-invocation: true` —
    // /specflow-auto chains phases via `Skill(specflow, "<phase>")`,
    // and that flag would block the chain on Claude Code (#166).
    assertEquals(
      routerContent.includes("disable-model-invocation: true"),
      false,
    );
  });
});

Deno.test("scaffolded .claude/CLAUDE.md documents /goal", async () => {
  await withTempDir(async (dir) => {
    const { code, stderr } = await runSpecflow(
      ["init", "demo", "--no-git", "--ai", "claude", "--backlog", "local"],
      { cwd: dir },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);
    const claudeMd = await Deno.readTextFile(
      join(dir, "demo/.claude/CLAUDE.md"),
    );
    assertStringIncludes(claudeMd, "## Optional integrations");
    assertStringIncludes(claudeMd, "Goal-directed sessions");
    assertStringIncludes(claudeMd, "/goal");
    assertStringIncludes(claudeMd, "code.claude.com/docs/fr/goal");
    assertStringIncludes(claudeMd, ".claude/loop.md");
  });
});

Deno.test("scaffolded .claude/CLAUDE.md documents `claude agents`", async () => {
  await withTempDir(async (dir) => {
    const { code, stderr } = await runSpecflow(
      ["init", "demo", "--no-git", "--ai", "claude", "--backlog", "local"],
      { cwd: dir },
    );
    assertEquals(code, 0, `init failed: ${stderr}`);
    const claudeMd = await Deno.readTextFile(
      join(dir, "demo/.claude/CLAUDE.md"),
    );
    assertStringIncludes(claudeMd, "Multi-session dispatch");
    assertStringIncludes(claudeMd, "claude agents");
    assertStringIncludes(claudeMd, "code.claude.com/docs/fr/agent-view");
    assertStringIncludes(claudeMd, ".claude/worktrees/");
  });
});
