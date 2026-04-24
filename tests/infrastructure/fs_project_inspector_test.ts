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
  await Deno.mkdir(join(dir, ".specify/memory"), { recursive: true });
  await Deno.mkdir(join(dir, ".claude/commands"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, ".specify/memory/constitution.md"),
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
    const specify = outcomes.find((o) => o.name === ".specify/");
    assertEquals(specify?.status, "pass");
    const claude = outcomes.find((o) => o.name === ".claude/");
    assertEquals(claude?.status, "pass");
  });
});

Deno.test("inspect reports fail when .specify missing", async () => {
  await withProjectDir(
    async (dir) => {
      await Deno.mkdir(join(dir, ".claude"), { recursive: true });
    },
    async (dir) => {
      const inspector = new FsProjectInspector();
      const outcomes = await inspector.inspect(dir, "0.2.0");
      const specify = outcomes.find((o) => o.name === ".specify/");
      assertEquals(specify?.status, "fail");
    },
  );
});

Deno.test("inspect reports warn for empty placeholder constitution", async () => {
  await withProjectDir(
    async (dir) => {
      await Deno.mkdir(join(dir, ".specify/memory"), { recursive: true });
      await Deno.mkdir(join(dir, ".claude"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specify/memory/constitution.md"),
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
      await Deno.mkdir(join(dir, ".specify/memory"), { recursive: true });
      await Deno.mkdir(join(dir, ".claude"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, ".specify/memory/constitution.md"),
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
