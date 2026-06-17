import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { FsProjectInspector } from "../../src/infrastructure/fs_project_inspector.ts";

const CONSTITUTION_FILLED = `# Project Constitution

## Principles

- No silent catches.
`;

const CONSTITUTION_EMPTY_PLACEHOLDER = `# Project Constitution

> Replace this placeholder with your own constitution.

## Principles

(none defined yet)
`;

async function withProjectDir(
  fill: (dir: string) => Promise<void>,
  fn: (dir: string) => Promise<void>,
) {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-inspect-" });
  try {
    await fill(dir);
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

async function filledProject(dir: string) {
  await Deno.mkdir(join(dir, ".specflow/memory"), { recursive: true });
  await Deno.mkdir(join(dir, ".claude/commands"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, ".specflow/memory/constitution.md"),
    CONSTITUTION_FILLED,
  );
  await Deno.writeTextFile(
    join(dir, ".specflow/installed.lock"),
    `version: 2
harness: claude
templates_version: 0.2.0
entries: {}
`,
  );
}

Deno.test("inspect returns all-pass for well-formed project", async () => {
  await withProjectDir(filledProject, async (dir) => {
    const inspector = new FsProjectInspector();
    const outcomes = await inspector.inspect(dir, "0.2.0");
    for (const o of outcomes) {
      assertEquals(
        o.status === "pass" || o.status === "warn",
        true,
        `${o.name} should be pass/warn`,
      );
    }
    const specify = outcomes.find((o) => o.name === ".specflow/");
    assertEquals(specify?.status, "pass");
    const harness = outcomes.find((o) => o.name === "harness");
    assertEquals(harness?.status, "pass");
    assertEquals(harness?.message.includes("claude"), true);
  });
});

Deno.test("inspect reports fail when .specflow missing", async () => {
  await withProjectDir(
    async (dir) => {
      await Deno.mkdir(join(dir, ".claude"), { recursive: true });
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.2.0");
      const specify = outcomes.find((o) => o.name === ".specflow/");
      assertEquals(specify?.status, "fail");
    },
  );
});

Deno.test("inspect reports warn for empty placeholder constitution", async () => {
  await withProjectDir(
    async (dir) => {
      await Deno.mkdir(join(dir, ".specflow/memory"), { recursive: true });
      await Deno.mkdir(join(dir, ".claude"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/memory/constitution.md"),
        CONSTITUTION_EMPTY_PLACEHOLDER,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.2.0");
      const constitution = outcomes.find((o) => o.name === "constitution");
      assertEquals(constitution?.status, "warn");
    },
  );
});

Deno.test("inspect passes when lock templates_version matches bundled", async () => {
  await withProjectDir(
    async (dir) => {
      await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/installed.lock"),
        `version: 1
templates_version: 0.2.0
entries: {}
`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.2.0");
      const tv = outcomes.find((o) => o.name === "templates version");
      assertEquals(tv?.status, "pass");
    },
  );
});

Deno.test("inspect warns when lock templates_version differs from bundled", async () => {
  await withProjectDir(
    async (dir) => {
      await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/installed.lock"),
        `version: 1
templates_version: 0.1.0
entries: {}
`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.2.0");
      const tv = outcomes.find((o) => o.name === "templates version");
      assertEquals(tv?.status, "warn");
      assertEquals(tv?.message.includes("specnaut upgrade"), true);
    },
  );
});

Deno.test("inspect warns when no installed.lock is present", async () => {
  await withProjectDir(
    async (_dir) => {},
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.2.0");
      const tv = outcomes.find((o) => o.name === "templates version");
      assertEquals(tv?.status, "warn");
      assertEquals(tv?.message.includes("installed.lock"), true);
    },
  );
});

Deno.test("inspect surfaces harness=claude when lock says claude and .claude/ exists", async () => {
  await withProjectDir(
    async (dir) => {
      await Deno.mkdir(join(dir, ".claude"), { recursive: true });
      await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/installed.lock"),
        `version: 2
harness: claude
templates_version: 0.3.0
entries: {}
`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.3.0");
      const h = outcomes.find((o) => o.name === "harness");
      assertEquals(h?.status, "pass");
      assertEquals(h?.message.includes("claude"), true);
    },
  );
});

Deno.test("inspect reports fail when lock harness does not match folder on disk", async () => {
  await withProjectDir(
    async (dir) => {
      // lock says cursor but only .claude/ is present
      await Deno.mkdir(join(dir, ".claude"), { recursive: true });
      await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/installed.lock"),
        `version: 2
harness: cursor
templates_version: 0.3.0
entries: {}
`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.3.0");
      const h = outcomes.find((o) => o.name === "harness");
      assertEquals(h?.status, "fail");
    },
  );
});

Deno.test("inspect surfaces harness=codex when lock says codex and .agents/ exists", async () => {
  await withProjectDir(
    async (dir) => {
      await Deno.mkdir(join(dir, ".agents/skills"), { recursive: true });
      await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/installed.lock"),
        `version: 2
harness: codex
templates_version: 0.4.0
entries: {}
`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.4.0");
      const h = outcomes.find((o) => o.name === "harness");
      assertEquals(h?.status, "pass");
      assertEquals(h?.message.includes("codex"), true);
    },
  );
});

Deno.test("inspect reports fail for codex lock when .agents/ missing", async () => {
  await withProjectDir(
    async (dir) => {
      // Lock says codex but no .agents/ directory on disk.
      await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/installed.lock"),
        `version: 2
harness: codex
templates_version: 0.4.0
entries: {}
`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.4.0");
      const h = outcomes.find((o) => o.name === "harness");
      assertEquals(h?.status, "fail");
    },
  );
});

Deno.test("inspect surfaces harness=windsurf when lock says windsurf and .windsurf/ exists", async () => {
  await withProjectDir(
    async (dir) => {
      await Deno.mkdir(join(dir, ".windsurf/workflows"), { recursive: true });
      await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/installed.lock"),
        `version: 2
harness: windsurf
templates_version: 0.6.0
entries: {}
`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.6.0");
      const h = outcomes.find((o) => o.name === "harness");
      assertEquals(h?.status, "pass");
      assertEquals(h?.message.includes("windsurf"), true);
    },
  );
});

Deno.test("inspect reports fail for windsurf lock when .windsurf/ missing", async () => {
  await withProjectDir(
    async (dir) => {
      await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/installed.lock"),
        `version: 2
harness: windsurf
templates_version: 0.6.0
entries: {}
`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.6.0");
      const h = outcomes.find((o) => o.name === "harness");
      assertEquals(h?.status, "fail");
    },
  );
});

Deno.test("inspect surfaces harness=copilot when lock says copilot and .github/instructions/ exists", async () => {
  await withProjectDir(
    async (dir) => {
      await Deno.mkdir(join(dir, ".github/instructions"), { recursive: true });
      await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/installed.lock"),
        `version: 2
harness: copilot
templates_version: 0.7.0
entries: {}
`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.7.0");
      const h = outcomes.find((o) => o.name === "harness");
      assertEquals(h?.status, "pass");
      assertEquals(h?.message.includes("copilot"), true);
    },
  );
});

Deno.test("inspect reports fail for copilot lock when .github/instructions/ missing", async () => {
  await withProjectDir(
    async (dir) => {
      await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/installed.lock"),
        `version: 2
harness: copilot
templates_version: 0.7.0
entries: {}
`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.7.0");
      const h = outcomes.find((o) => o.name === "harness");
      assertEquals(h?.status, "fail");
    },
  );
});

// Helper: write a Claude-harness lock so checkClaudeConfig kicks in.
async function writeClaudeLock(dir: string) {
  await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, ".specflow/installed.lock"),
    `version: 2
harness: claude
templates_version: 0.7.0
entries: {}
`,
  );
}

Deno.test("inspect skips Claude-config checks for non-Claude harnesses", async () => {
  await withProjectDir(
    async (dir) => {
      await Deno.mkdir(join(dir, ".cursor"), { recursive: true });
      await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/installed.lock"),
        `version: 2
harness: cursor
templates_version: 0.7.0
entries: {}
`,
      );
      // Even with a malformed settings.json sitting around, cursor harness
      // means we don't lint it.
      await Deno.mkdir(join(dir, ".claude"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".claude/settings.json"),
        `{ "hooks": { "PostToolUse": [ { "matcher": ["Edit"] } ] } }`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.7.0");
      assertEquals(
        outcomes.find((o) => o.name.includes("settings.json")),
        undefined,
      );
    },
  );
});

Deno.test("inspect passes when .claude/settings.json has valid hooks", async () => {
  await withProjectDir(
    async (dir) => {
      await writeClaudeLock(dir);
      await Deno.mkdir(join(dir, ".claude"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".claude/settings.json"),
        JSON.stringify({
          hooks: {
            PostToolUse: [
              { matcher: "Edit|Write", hooks: [{ type: "command", command: "echo" }] },
            ],
          },
        }),
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.7.0");
      const o = outcomes.find((o) => o.name === ".claude/settings.json hooks");
      assertEquals(o?.status, "pass");
    },
  );
});

Deno.test("inspect fails when hooks matcher is an array (common mistake)", async () => {
  await withProjectDir(
    async (dir) => {
      await writeClaudeLock(dir);
      await Deno.mkdir(join(dir, ".claude"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".claude/settings.json"),
        JSON.stringify({
          hooks: {
            PostToolUse: [
              { matcher: ["Edit", "Write"], hooks: [{ type: "command", command: "echo" }] },
            ],
          },
        }),
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.7.0");
      const o = outcomes.find((o) => o.name === ".claude/settings.json hooks");
      assertEquals(o?.status, "fail");
      assertEquals(o?.message.includes("matcher must be a string"), true);
    },
  );
});

Deno.test("inspect fails when hooks entries[].hooks is missing", async () => {
  await withProjectDir(
    async (dir) => {
      await writeClaudeLock(dir);
      await Deno.mkdir(join(dir, ".claude"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".claude/settings.json"),
        JSON.stringify({
          hooks: {
            PostToolUse: [{ matcher: "Edit" }], // forgot the inner hooks array
          },
        }),
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.7.0");
      const o = outcomes.find((o) => o.name === ".claude/settings.json hooks");
      assertEquals(o?.status, "fail");
    },
  );
});

Deno.test("inspect fails when settings.json is invalid JSON", async () => {
  await withProjectDir(
    async (dir) => {
      await writeClaudeLock(dir);
      await Deno.mkdir(join(dir, ".claude"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".claude/settings.json"),
        `{ "hooks": [`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.7.0");
      const o = outcomes.find((o) => o.name === ".claude/settings.json");
      assertEquals(o?.status, "fail");
      assertEquals(o?.message.includes("invalid JSON"), true);
    },
  );
});

Deno.test("inspect warns on .mcp.json with relative command path", async () => {
  await withProjectDir(
    async (dir) => {
      await writeClaudeLock(dir);
      await Deno.writeTextFile(
        join(dir, ".mcp.json"),
        JSON.stringify({
          mcpServers: {
            github: { command: "./bin/github-mcp", args: [] },
          },
        }),
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.7.0");
      const o = outcomes.find((o) => o.name === ".mcp.json");
      assertEquals(o?.status, "warn");
      assertEquals(o?.message.includes("relative path"), true);
    },
  );
});

Deno.test("inspect passes on .mcp.json with absolute / npx command", async () => {
  await withProjectDir(
    async (dir) => {
      await writeClaudeLock(dir);
      await Deno.writeTextFile(
        join(dir, ".mcp.json"),
        JSON.stringify({
          mcpServers: {
            github: { command: "npx", args: ["-y", "@github/mcp"] },
          },
        }),
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.7.0");
      const o = outcomes.find((o) => o.name === ".mcp.json");
      assertEquals(o?.status, "pass");
    },
  );
});

Deno.test("inspect fails on invalid JSON in .mcp.json", async () => {
  await withProjectDir(
    async (dir) => {
      await writeClaudeLock(dir);
      await Deno.writeTextFile(join(dir, ".mcp.json"), `{ broken`);
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.7.0");
      const o = outcomes.find((o) => o.name === ".mcp.json");
      assertEquals(o?.status, "fail");
    },
  );
});

Deno.test("inspect reports pass when opencode harness is set and .opencode/ exists", async () => {
  await withProjectDir(
    async (dir) => {
      await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
      await Deno.mkdir(join(dir, ".opencode/agents"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/installed.lock"),
        `version: 2
harness: opencode
templates_version: 0.7.0
entries: {}
`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.7.0");
      const harness = outcomes.find((o) => o.name === "harness");
      assertEquals(harness?.status, "pass");
      assertEquals(harness?.message, "opencode — .opencode/ present");
    },
  );
});

// ── backlog backend (#104) ─────────────────────────────────────────────────

async function backlogProject(
  dir: string,
  backend: "local" | "github" | "gitlab",
  configYml?: string,
): Promise<void> {
  await Deno.mkdir(join(dir, ".specflow/memory"), { recursive: true });
  await Deno.mkdir(join(dir, ".claude"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, ".specflow/memory/constitution.md"),
    CONSTITUTION_FILLED,
  );
  await Deno.writeTextFile(
    join(dir, ".specflow/installed.lock"),
    `version: 2
harness: claude
backlog_backend: ${backend}
templates_version: 0.7.0
entries: {}
`,
  );
  if (configYml !== undefined) {
    await Deno.writeTextFile(
      join(dir, ".specflow/backlog-config.yml"),
      configYml,
    );
  }
}

Deno.test("inspect surfaces backlog backend = local with pass status (zero-config)", async () => {
  await withProjectDir(
    (dir) => backlogProject(dir, "local"),
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.7.0");
      const o = outcomes.find((x) => x.name === "backlog backend");
      assertEquals(o?.status, "pass");
      assertEquals(o?.message, "local — zero-config");
    },
  );
});

Deno.test("inspect warns when github backend has empty repo and project_number", async () => {
  await withProjectDir(
    (dir) =>
      backlogProject(
        dir,
        "github",
        `repo: ""
project_number: ""
project_node_id: ""
status_field_id: ""
`,
      ),
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.7.0");
      const o = outcomes.find((x) => x.name === "backlog backend");
      assertEquals(o?.status, "warn");
      assertEquals(o?.message.includes("repo"), true);
      assertEquals(o?.message.includes("project_number"), true);
      assertEquals(o?.message.includes("PO will fail at runtime"), true);
    },
  );
});

Deno.test("inspect warns when github backend has only repo filled (project_number still empty)", async () => {
  await withProjectDir(
    (dir) =>
      backlogProject(
        dir,
        "github",
        `repo: myorg/myproject
project_number: ""
`,
      ),
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.7.0");
      const o = outcomes.find((x) => x.name === "backlog backend");
      assertEquals(o?.status, "warn");
      assertEquals(o?.message.includes("project_number"), true);
      assertEquals(o?.message.includes("repo"), false);
    },
  );
});

Deno.test("inspect passes when github backend has both required fields filled", async () => {
  await withProjectDir(
    (dir) =>
      backlogProject(
        dir,
        "github",
        `repo: myorg/myproject
project_number: 4
`,
      ),
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.7.0");
      const o = outcomes.find((x) => x.name === "backlog backend");
      assertEquals(o?.status, "pass");
      assertEquals(o?.message, "github — backlog-config.yml configured");
    },
  );
});

Deno.test("inspect warns when gitlab backend has empty project_id", async () => {
  await withProjectDir(
    (dir) =>
      backlogProject(
        dir,
        "gitlab",
        `host: gitlab.com
project_id: ""
`,
      ),
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.7.0");
      const o = outcomes.find((x) => x.name === "backlog backend");
      assertEquals(o?.status, "warn");
      assertEquals(o?.message.includes("project_id"), true);
    },
  );
});

Deno.test("inspect passes when gitlab backend has project_id filled", async () => {
  await withProjectDir(
    (dir) =>
      backlogProject(
        dir,
        "gitlab",
        `host: gitlab.com
project_id: 12345
`,
      ),
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.7.0");
      const o = outcomes.find((x) => x.name === "backlog backend");
      assertEquals(o?.status, "pass");
      assertEquals(o?.message, "gitlab — backlog-config.yml configured");
    },
  );
});

Deno.test("inspect warns when github backend lock is set but backlog-config.yml is missing", async () => {
  await withProjectDir(
    (dir) => backlogProject(dir, "github" /* no configYml */),
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.7.0");
      const o = outcomes.find((x) => x.name === "backlog backend");
      assertEquals(o?.status, "warn");
      assertEquals(o?.message.includes("backlog-config.yml missing"), true);
      assertEquals(o?.message.includes("specnaut upgrade --backlog github"), true);
    },
  );
});

Deno.test("inspect fails when backlog-config.yml is invalid YAML", async () => {
  await withProjectDir(
    (dir) =>
      backlogProject(
        dir,
        "github",
        `repo: "myorg/myproject
project_number: 4
`, // unterminated quote
      ),
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.7.0");
      const o = outcomes.find((x) => x.name === "backlog backend");
      assertEquals(o?.status, "fail");
      assertEquals(o?.message.includes("invalid YAML"), true);
    },
  );
});

// ── Plugin gap detection (#73 slice 7) ─────────────────────────────────────

import type { PluginDetector } from "../../src/application/ports.ts";

function fakePluginDetector(installed: boolean): PluginDetector {
  return { isPluginInstalled: (_n: string) => Promise.resolve(installed) };
}

Deno.test("inspect: plugin gap check skipped when no pluginDetector is configured", async () => {
  await withProjectDir(filledProject, async (dir) => {
    const inspector = new FsProjectInspector();
    const outcomes = await inspector.inspect(dir, "0.2.0");
    const gapOutcomes = outcomes.filter((o) =>
      o.name.startsWith(".claude/agents/") || o.name.startsWith(".claude/skills/")
    );
    assertEquals(gapOutcomes.length, 0);
  });
});

Deno.test("inspect: plugin gap check emits no warnings when plugin IS installed", async () => {
  await withProjectDir(filledProject, async (dir) => {
    const inspector = new FsProjectInspector(fakePluginDetector(true));
    const outcomes = await inspector.inspect(dir, "0.2.0");
    const gapOutcomes = outcomes.filter((o) =>
      o.name.startsWith(".claude/agents/") ||
      o.name.startsWith(".claude/skills/specnaut-")
    );
    assertEquals(gapOutcomes.length, 0);
  });
});

Deno.test("inspect: plugin gap check warns for each missing covered path when plugin NOT installed", async () => {
  await withProjectDir(filledProject, async (dir) => {
    const inspector = new FsProjectInspector(fakePluginDetector(false));
    const outcomes = await inspector.inspect(dir, "0.2.0");
    const gapOutcomes = outcomes.filter((o) =>
      (o.name.startsWith(".claude/agents/") ||
        o.name.startsWith(".claude/skills/specnaut/") ||
        o.name === ".claude/skills/specnaut/SKILL.md" ||
        o.name === ".claude/skills/specnaut-review/SKILL.md" ||
        o.name === ".claude/skills/specnaut-auto/SKILL.md") &&
      o.status === "warn"
    );
    // 15 agents (10 original + ui-ux-designer drift fix #321 +
    // performance-auditor #304 + a11y-auditor #305 + architecture-auditor
    // #321 + dependency-auditor #322) + 1 router skill + 20 phase docs
    // (the 11 original + tag-version + release-version + list-skills +
    // audit-security #303 + audit-performance #304 + audit-accessibility
    // #305 + audit-architecture #321 + audit-dependencies #322 +
    // lite-heuristic #346) + specnaut-review alias + specnaut-auto = 38
    // covered paths.
    assertEquals(gapOutcomes.length, 38);
    for (const o of gapOutcomes) {
      assertEquals(o.message.includes("missing"), true);
      assertEquals(o.message.includes("specnaut upgrade"), true);
      assertEquals(o.message.includes("/plugin install specnaut-plugin"), true);
    }
  });
});

Deno.test("inspect: plugin gap check skipped on non-claude harnesses", async () => {
  await withProjectDir(
    async (dir) => {
      await Deno.mkdir(join(dir, ".specflow/memory"), { recursive: true });
      await Deno.mkdir(join(dir, ".cursor"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/memory/constitution.md"),
        CONSTITUTION_FILLED,
      );
      await Deno.writeTextFile(
        join(dir, ".specflow/installed.lock"),
        `version: 2
harness: cursor
templates_version: 0.7.0
entries: {}
`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector(fakePluginDetector(false));
      const outcomes = await inspector.inspect(dir, "0.7.0");
      const gapOutcomes = outcomes.filter((o) => o.name.startsWith(".claude/"));
      assertEquals(gapOutcomes.length, 0);
    },
  );
});

Deno.test("inspect: plugin gap check warns ONLY for the agents the user actually deleted", async () => {
  await withProjectDir(
    async (dir) => {
      await filledProject(dir);
      await Deno.mkdir(join(dir, ".claude/agents"), { recursive: true });
      // Scaffold every covered agent EXCEPT product-owner (simulating
      // that one alone got deleted post-migration). The set tracks
      // PLUGIN_COVERED_PATHS_CLAUDE — 15 agents minus product-owner = 14.
      for (
        const name of [
          "code-reviewer",
          "developer",
          "devops-sre",
          "qa-tester",
          "review-coordinator",
          "security-auditor",
          "specnaut-expert",
          "test-reviewer",
          "workflow-manager",
          "ui-ux-designer",
          "performance-auditor",
          "a11y-auditor",
          "architecture-auditor",
          "dependency-auditor",
        ]
      ) {
        await Deno.writeTextFile(join(dir, `.claude/agents/${name}.md`), "stub");
      }
      // Scaffold all skills + commands too (only the agent gap should warn)
      await Deno.mkdir(join(dir, ".claude/skills/specnaut-auto"), { recursive: true });
      await Deno.writeTextFile(join(dir, ".claude/skills/specnaut-auto/SKILL.md"), "stub");
      await Deno.mkdir(join(dir, ".claude/skills/specnaut-groom"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".claude/skills/specnaut-groom/SKILL.md"),
        "stub",
      );
      for (
        const name of [
          "analyze",
          "checklist",
          "clarify",
          "constitution",
          "implement",
          "merge",
          "plan",
          "review",
          "specify",
          "tasks",
        ]
      ) {
        await Deno.mkdir(join(dir, `.claude/skills/specnaut-${name}`), {
          recursive: true,
        });
        await Deno.writeTextFile(
          join(dir, `.claude/skills/specnaut-${name}/SKILL.md`),
          "stub",
        );
      }
    },
    async (dir) => {
      const inspector = new FsProjectInspector(fakePluginDetector(false));
      const outcomes = await inspector.inspect(dir, "0.2.0");
      const gapOutcomes = outcomes.filter((o) =>
        o.name.startsWith(".claude/agents/") && o.status === "warn"
      );
      assertEquals(gapOutcomes.length, 1);
      assertEquals(gapOutcomes[0].name, ".claude/agents/product-owner.md");
    },
  );
});
