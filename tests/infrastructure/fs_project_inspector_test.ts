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
  const dir = await Deno.makeTempDir({ prefix: "specflow-inspect-" });
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
  await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, ".specflow/config.yml"),
    `version: 1
sync:
  provider: github
  repo: kevinraimbaud/specflow
  label_prefix: backlog/
`,
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

Deno.test("inspect warns when .specflow/config.yml is missing (optional)", async () => {
  await withProjectDir(
    async (dir) => {
      await Deno.mkdir(join(dir, ".specflow/memory"), { recursive: true });
      await Deno.mkdir(join(dir, ".claude"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/memory/constitution.md"),
        CONSTITUTION_FILLED,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.2.0");
      const backlog = outcomes.find((o) => o.name === "backlog config");
      assertEquals(backlog?.status, "warn");
    },
  );
});

Deno.test("inspect passes when lock templates_version matches binary", async () => {
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

Deno.test("inspect warns when lock templates_version differs from binary", async () => {
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
      assertEquals(tv?.message.includes("specflow upgrade"), true);
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

Deno.test("inspect surfaces harness=gemini when lock says gemini and .gemini/ exists", async () => {
  await withProjectDir(
    async (dir) => {
      await Deno.mkdir(join(dir, ".gemini/commands"), { recursive: true });
      await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/installed.lock"),
        `version: 2
harness: gemini
templates_version: 0.5.0
entries: {}
`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.5.0");
      const h = outcomes.find((o) => o.name === "harness");
      assertEquals(h?.status, "pass");
      assertEquals(h?.message.includes("gemini"), true);
    },
  );
});

Deno.test("inspect reports fail for gemini lock when .gemini/ missing", async () => {
  await withProjectDir(
    async (dir) => {
      await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specflow/installed.lock"),
        `version: 2
harness: gemini
templates_version: 0.5.0
entries: {}
`,
      );
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.5.0");
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
