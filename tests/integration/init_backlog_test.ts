import { assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs/exists";
import { fromFileUrl, join } from "@std/path";

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

async function runSpecflow(
  args: string[],
  opts: { cwd: string },
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
  const dir = await Deno.makeTempDir({ prefix: "specflow-backlog-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("init --backlog local renders the local backlog skill", async () => {
  await withTempDir(async (parent) => {
    const r = await runSpecflow(
      ["init", "demo", "--no-git", "--ai", "claude", "--backlog", "local"],
      { cwd: parent },
    );
    assertEquals(r.code, 0, r.stderr);

    const skill = await Deno.readTextFile(
      join(parent, "demo/.claude/skills/backlog/SKILL.md"),
    );
    assertStringIncludes(skill, "Backend: local Markdown files");
    assertEquals(skill.includes("Backend: GitHub"), false);
    assertEquals(skill.includes("BEGIN: backend="), false);
    assertEquals(skill.includes("END: backend="), false);

    // Local backend scripts present
    assertEquals(
      await exists(join(parent, "demo/.specflow/scripts/backlog/list.sh")),
      true,
    );
    assertEquals(
      await exists(join(parent, "demo/.specflow/scripts/backlog/add.sh")),
      true,
    );
    // No backlog-config.yml for the local backend
    assertEquals(
      await exists(join(parent, "demo/.specflow/backlog-config.yml")),
      false,
    );

    // Lock records the backend
    const lock = await Deno.readTextFile(
      join(parent, "demo/.specflow/installed.lock"),
    );
    assertStringIncludes(lock, "backlog_backend: local");
  });
});

Deno.test("init --backlog github renders the github skill + writes config stub", async () => {
  await withTempDir(async (parent) => {
    const r = await runSpecflow(
      ["init", "demo", "--no-git", "--ai", "claude", "--backlog", "github"],
      { cwd: parent },
    );
    assertEquals(r.code, 0, r.stderr);

    const skill = await Deno.readTextFile(
      join(parent, "demo/.claude/skills/backlog/SKILL.md"),
    );
    assertStringIncludes(skill, "Backend: GitHub Issues + Project");
    assertEquals(skill.includes("Backend: local Markdown"), false);
    // The github skill now documents both MCP and shell paths
    assertStringIncludes(skill, "GitHub MCP — preferred when available");
    assertStringIncludes(skill, "mcp__github__issue_write");
    assertStringIncludes(skill, "Shell scripts — always available");
    assertStringIncludes(skill, "@modelcontextprotocol/server-github");

    // GitHub-flavored scripts present, local ones filtered out
    assertEquals(
      await exists(join(parent, "demo/.specflow/scripts/backlog/_config.sh")),
      true,
    );
    const addScript = await Deno.readTextFile(
      join(parent, "demo/.specflow/scripts/backlog/add.sh"),
    );
    assertStringIncludes(addScript, "gh issue create");

    // Config stub written + lock records backend
    const config = await Deno.readTextFile(
      join(parent, "demo/.specflow/backlog-config.yml"),
    );
    assertStringIncludes(config, "repo:");
    assertStringIncludes(config, "project_number:");

    const lock = await Deno.readTextFile(
      join(parent, "demo/.specflow/installed.lock"),
    );
    assertStringIncludes(lock, "backlog_backend: github");
  });
});

Deno.test("upgrade --backlog github switches a local project to github", async () => {
  await withTempDir(async (parent) => {
    const init = await runSpecflow(
      ["init", "demo", "--no-git", "--ai", "claude", "--backlog", "local"],
      { cwd: parent },
    );
    assertEquals(init.code, 0, init.stderr);

    const projectDir = join(parent, "demo");

    const upgrade = await runSpecflow(
      ["upgrade", "--backlog", "github"],
      { cwd: projectDir },
    );
    assertEquals(upgrade.code, 0, upgrade.stderr);
    assertStringIncludes(upgrade.stdout, "switched backlog backend: local → github");

    // Skill re-rendered
    const skill = await Deno.readTextFile(
      join(projectDir, ".claude/skills/backlog/SKILL.md"),
    );
    assertStringIncludes(skill, "Backend: GitHub Issues + Project");
    assertEquals(skill.includes("Backend: local Markdown"), false);

    // Old local-backend scripts removed, github scripts present
    assertEquals(
      await exists(join(projectDir, ".specflow/scripts/backlog/_config.sh")),
      true,
    );

    // Lock updated
    const lock = await Deno.readTextFile(
      join(projectDir, ".specflow/installed.lock"),
    );
    assertStringIncludes(lock, "backlog_backend: github");
  });
});

Deno.test("upgrade --backlog <same> is a no-op", async () => {
  await withTempDir(async (parent) => {
    const init = await runSpecflow(
      ["init", "demo", "--no-git", "--ai", "claude", "--backlog", "local"],
      { cwd: parent },
    );
    assertEquals(init.code, 0, init.stderr);

    const projectDir = join(parent, "demo");
    const upgrade = await runSpecflow(
      ["upgrade", "--backlog", "local"],
      { cwd: projectDir },
    );
    assertEquals(upgrade.code, 0, upgrade.stderr);
    assertStringIncludes(upgrade.stdout, "already using backend: local");
  });
});
