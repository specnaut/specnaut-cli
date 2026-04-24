import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

const MAIN = new URL("../../src/main.ts", import.meta.url).pathname;
const SHIM_DIR = new URL("./fixtures/", import.meta.url).pathname;

async function run(args: string[], opts: { cwd: string; logFile: string }) {
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
    env: {
      PATH: `${SHIM_DIR}:${Deno.env.get("PATH") ?? ""}`,
      GH_SHIM_LOG: opts.logFile,
    },
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

async function setupProject(): Promise<{ dir: string; logFile: string }> {
  const dir = await Deno.makeTempDir({ prefix: "specflow-integ-bs-" });
  const logFile = `${dir}/gh.log`;

  const git = async (...a: string[]) =>
    await new Deno.Command("git", {
      args: a,
      cwd: dir,
      stdout: "null",
      stderr: "null",
    }).output();
  await git("init");
  await git("remote", "add", "origin", "https://github.com/kevin/specflow.git");

  await Deno.mkdir(join(dir, ".specflow"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, ".specflow/config.yml"),
    `version: 1
sync:
  provider: github
  repo: kevin/specflow
  label_prefix: backlog/
`,
  );

  await Deno.mkdir(join(dir, "tasks/backlog"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, "tasks/backlog/001-hello.md"),
    `---
id: "001"
title: "Hello"
category: devex
priority: high
complexity: 3
status: todo
depends_on: []
spec: null
tags: []
created: 2026-04-24
---

A first task.
`,
  );

  return { dir, logFile };
}

async function teardown(dir: string) {
  await Deno.remove(dir, { recursive: true });
}

Deno.test("specflow backlog sync --dry-run prints create plan", async () => {
  const { dir, logFile } = await setupProject();
  try {
    const { code, stdout } = await run(["backlog", "sync", "--dry-run"], {
      cwd: dir,
      logFile,
    });
    assertEquals(code, 0);
    assertStringIncludes(stdout, "+ 001 create");
  } finally {
    await teardown(dir);
  }
});

Deno.test("specflow backlog sync calls gh with expected args", async () => {
  const { dir, logFile } = await setupProject();
  try {
    const { code } = await run(["backlog", "sync"], { cwd: dir, logFile });
    assertEquals(code, 0);
    const log = await Deno.readTextFile(logFile);
    assertStringIncludes(log, "issue list");
    assertStringIncludes(log, "issue create");
    assertStringIncludes(log, "backlog/001");
    assertStringIncludes(log, "priority/high");
  } finally {
    await teardown(dir);
  }
});

Deno.test("specflow backlog sync exits 2 when config missing", async () => {
  const dir = await Deno.makeTempDir({ prefix: "specflow-integ-bs-noconfig-" });
  try {
    await Deno.mkdir(join(dir, "backlog"), { recursive: true });
    const { code, stderr } = await run(["backlog", "sync"], {
      cwd: dir,
      logFile: `${dir}/x.log`,
    });
    assertEquals(code, 2);
    assertStringIncludes(stderr, "specflow backlog configure");
  } finally {
    await teardown(dir);
  }
});

Deno.test("specflow backlog sync --id filters to the specified task", async () => {
  const { dir, logFile } = await setupProject();
  try {
    await Deno.writeTextFile(
      join(dir, "tasks/backlog/002-second.md"),
      `---
id: "002"
title: "Second"
category: devex
priority: low
complexity: 1
status: todo
depends_on: []
spec: null
tags: []
created: 2026-04-24
---

Second task.
`,
    );
    const { code } = await run(["backlog", "sync", "--id", "002"], {
      cwd: dir,
      logFile,
    });
    assertEquals(code, 0);
    const log = await Deno.readTextFile(logFile);
    assertStringIncludes(log, "backlog/002");
    const createCount = (log.match(/issue create/g) || []).length;
    assertEquals(createCount, 1);
  } finally {
    await teardown(dir);
  }
});
