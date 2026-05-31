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
      [
        "init",
        "demo",
        "--no-git",
        "--ai",
        "claude",
        "--backlog",
        "github",
        "--backlog-url",
        "https://github.com/orgs/myorg/projects/42",
        "--backlog-repo",
        "myorg/myrepo",
      ],
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

    // Config stub written + populated from --backlog-url + --backlog-repo
    const config = await Deno.readTextFile(
      join(parent, "demo/.specflow/backlog-config.yml"),
    );
    assertStringIncludes(config, `repo: "myorg/myrepo"`);
    assertStringIncludes(config, `project_number: "42"`);
    // No "Fill in" reminder when populated stub renders
    assertEquals(config.includes("Fill in"), false);

    const lock = await Deno.readTextFile(
      join(parent, "demo/.specflow/installed.lock"),
    );
    assertStringIncludes(lock, "backlog_backend: github");
  });
});

Deno.test("init --backlog cloud renders the cloud skill + writes config stub (no URL needed)", async () => {
  await withTempDir(async (parent) => {
    const r = await runSpecflow(
      ["init", "demo", "--no-git", "--ai", "claude", "--backlog", "cloud"],
      { cwd: parent },
    );
    assertEquals(r.code, 0, r.stderr);

    const skill = await Deno.readTextFile(
      join(parent, "demo/.claude/skills/backlog/SKILL.md"),
    );
    assertStringIncludes(skill, "Backend: Specflow Cloud");
    assertEquals(skill.includes("Backend: local Markdown"), false);
    assertEquals(skill.includes("Backend: GitHub"), false);

    // Cloud-flavored scripts present; add.sh hits the HTTP API, not gh/glab
    assertEquals(
      await exists(join(parent, "demo/.specflow/scripts/backlog/_config.sh")),
      true,
    );
    const addScript = await Deno.readTextFile(
      join(parent, "demo/.specflow/scripts/backlog/add.sh"),
    );
    assertStringIncludes(addScript, "Authorization: Bearer");
    assertStringIncludes(addScript, "$API_BASE/tasks");
    assertEquals(addScript.includes("gh issue create"), false);
    // The /api/v1 base lives in _config.sh, which now sources a fresh token
    // from `specflow cloud token` (credentials live in the keychain, not the yml).
    const configScript = await Deno.readTextFile(
      join(parent, "demo/.specflow/scripts/backlog/_config.sh"),
    );
    assertStringIncludes(configScript, "/api/v1");
    assertStringIncludes(configScript, "specflow cloud token");
    assertEquals(configScript.includes("extract api_token"), false);

    // Config stub: backend + non-secret coordinates only. No api_token field —
    // the secret is obtained via `specflow cloud login` and stored securely.
    const config = await Deno.readTextFile(
      join(parent, "demo/.specflow/backlog-config.yml"),
    );
    assertStringIncludes(config, "backend: cloud");
    assertStringIncludes(config, "api_url:");
    assertStringIncludes(config, "project_key:");
    assertEquals(config.includes("api_token:"), false);

    const lock = await Deno.readTextFile(
      join(parent, "demo/.specflow/installed.lock"),
    );
    assertStringIncludes(lock, "backlog_backend: cloud");
  });
});

Deno.test("init --backlog gitlab renders the gitlab skill + writes config stub", async () => {
  await withTempDir(async (parent) => {
    const r = await runSpecflow(
      [
        "init",
        "demo",
        "--no-git",
        "--ai",
        "claude",
        "--backlog",
        "gitlab",
        "--backlog-url",
        "https://gitlab.com/mygroup/myproject",
      ],
      { cwd: parent },
    );
    assertEquals(r.code, 0, r.stderr);

    const skill = await Deno.readTextFile(
      join(parent, "demo/.claude/skills/backlog/SKILL.md"),
    );
    assertStringIncludes(skill, "Backend: GitLab Issues + scoped Status labels");
    assertEquals(skill.includes("Backend: local Markdown"), false);
    assertEquals(skill.includes("Backend: GitHub"), false);
    assertStringIncludes(skill, "glab issue close");

    // GitLab-flavored scripts present
    assertEquals(
      await exists(join(parent, "demo/.specflow/scripts/backlog/_config.sh")),
      true,
    );
    const addScript = await Deno.readTextFile(
      join(parent, "demo/.specflow/scripts/backlog/add.sh"),
    );
    assertStringIncludes(addScript, "glab issue create");
    assertStringIncludes(addScript, "Status::Backlog");

    // Config stub populated from --backlog-url
    const config = await Deno.readTextFile(
      join(parent, "demo/.specflow/backlog-config.yml"),
    );
    assertStringIncludes(config, `host: gitlab.com`);
    assertStringIncludes(config, `project_id: "mygroup/myproject"`);
    assertEquals(config.includes("Fill in"), false);

    const lock = await Deno.readTextFile(
      join(parent, "demo/.specflow/installed.lock"),
    );
    assertStringIncludes(lock, "backlog_backend: gitlab");
  });
});

Deno.test(
  "init --backlog github without --backlog-url fails fast in non-TTY",
  async () => {
    await withTempDir(async (parent) => {
      const r = await runSpecflow(
        ["init", "demo", "--no-git", "--ai", "claude", "--backlog", "github"],
        { cwd: parent },
      );
      assertEquals(r.code, 2, r.stdout + r.stderr);
      assertStringIncludes(
        r.stderr,
        "--backlog github requires --backlog-url",
      );
    });
  },
);

Deno.test(
  "init --backlog github with malformed --backlog-url fails with clear message",
  async () => {
    await withTempDir(async (parent) => {
      const r = await runSpecflow(
        [
          "init",
          "demo",
          "--no-git",
          "--ai",
          "claude",
          "--backlog",
          "github",
          "--backlog-url",
          "not-a-url",
        ],
        { cwd: parent },
      );
      assertEquals(r.code, 2, r.stdout + r.stderr);
      assertStringIncludes(r.stderr, "not a recognised project URL");
    });
  },
);

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
