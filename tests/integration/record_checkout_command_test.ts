import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { bundleForLock } from "../../src/application/lock_bundle.ts";
import { findHarness } from "../../src/cli/harnesses.ts";
import { parseLock } from "../../src/domain/installed_lock.ts";
import { sha256HexBytes } from "../../src/domain/sha256.ts";
import { CORE_BUNDLE } from "../../src/templates_bundle.ts";
import { runSpecnaut } from "../helpers/run_specnaut.ts";
import { BASE_FILES, SETTINGS, setUp } from "./verify_checkout_fixture.ts";
import { git, LOCK, write } from "./verify_scripts_fixture.ts";

/**
 * `specnaut record-checkout`, black-box, as the `SessionStart` hook runs it: the hook's input on
 * stdin, `CLAUDE_ENV_FILE` naming the file the harness sources before the session's commands.
 */

const ID = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f";
const POSIX = Deno.build.os !== "windows";

async function session(root: string, source: string, id = ID) {
  const envFile = join(await Deno.makeTempDir({ prefix: "claude-env-" }), "env.sh");
  await Deno.writeTextFile(envFile, "");
  const input = JSON.stringify({
    session_id: id,
    source,
    cwd: root,
    hook_event_name: "SessionStart",
  });
  const run = await runSpecnaut(["record-checkout"], {
    cwd: root,
    stdin: input,
    env: { CLAUDE_ENV_FILE: envFile },
  });
  return { ...run, env: await Deno.readTextFile(envFile) };
}

/** Where the record of session `id` lives: the worktree's own git directory, never the tree. */
async function recordPath(root: string, id = ID): Promise<string> {
  const gitDir = (await git(root, "rev-parse", "--absolute-git-dir")).trim();
  return join(gitDir, "specnaut", "session", `${id}.json`);
}

/** Whether the command said anything on stderr (the runtime's own warnings aside). */
const said = (stderr: string) => stderr.includes("specnaut record-checkout");

const exists = (path: string) => Deno.lstat(path).then(() => true, () => false);

Deno.test("a session's start records HEAD and every checked file, untracked and ignored ones included", async () => {
  const { root } = await setUp();
  await write(root, { ".claude/settings.local.json": "{}\n", ".mise.toml": "x\n" });
  const run = await session(root, "startup");
  assertEquals([run.code, run.stdout, said(run.stderr)], [0, "", false]);
  const path = await recordPath(root);
  const record = JSON.parse(await Deno.readTextFile(path));
  assertEquals(record.version, 1);
  assertEquals(record.head, (await git(root, "rev-parse", "HEAD")).trim());
  const files = new Map<string, string>();
  for (const walk of record.tree) {
    for (const e of walk.entries ?? []) if (e.kind === "file") files.set(e.path, e.sha256);
  }
  const digest = (s: string) => sha256HexBytes(new TextEncoder().encode(s));
  assertEquals(files.get(SETTINGS), await digest(BASE_FILES[SETTINGS]));
  assertEquals(files.get("AGENTS.md"), await digest("rules\n"));
  assertEquals(files.get(".claude/settings.local.json"), await digest("{}\n"), "ignored");
  assertEquals(files.get(".mise.toml"), await digest("x\n"), "untracked");
  assertEquals(files.has(".specnaut/scripts/bash/git-read.sh"), false, "the script check's own");
  assertEquals(run.env, `export SPECNAUT_SESSION_RECORD='${path}'\n`);
  const status = await git(root, "status", "--porcelain", "--ignored", "--untracked-files=all");
  assertEquals(status.includes("session"), false, "nothing written in the work tree");
});

Deno.test("startup, resume and fork take the record; clear and compact keep it as it was", async () => {
  const { root } = await setUp();
  const path = await recordPath(root);
  for (const source of ["startup", "resume", "fork"]) {
    if (await exists(path)) await Deno.remove(path);
    const run = await session(root, source);
    assertEquals(run.code, 0, source);
    assert(await exists(path), `${source} takes a record`);
    assertEquals(run.env, `export SPECNAUT_SESSION_RECORD='${path}'\n`, source);
  }
  const taken = await Deno.readTextFile(path);
  await write(root, { "AGENTS.md": "switched inside the session\n" });
  for (const source of ["clear", "compact", "other"]) {
    const run = await session(root, source);
    assertEquals([run.code, run.stdout, said(run.stderr), run.env], [0, "", false, ""], source);
    assertEquals(await Deno.readTextFile(path), taken, `${source} never retakes it`);
  }
  for (const source of ["clear", "compact"]) {
    if (await exists(path)) await Deno.remove(path);
    await session(root, source);
    assertEquals(await exists(path), false, `${source} never takes one either`);
  }
  await session(root, "startup");
  const first = await Deno.readTextFile(path);
  await write(root, { "AGENTS.md": "switched before resuming\n" });
  for (const source of ["resume", "fork", "startup"]) {
    const run = await session(root, source);
    assertEquals(run.code, 0, source);
    assertEquals(await Deno.readTextFile(path), first, `${source} never replaces the first record`);
    assertEquals(run.env, `export SPECNAUT_SESSION_RECORD='${path}'\n`, `${source} finds it`);
  }
});

Deno.test({
  name:
    "the record is created new and renamed into place: a link already there is never written through",
  ignore: !POSIX,
  fn: async () => {
    const { root } = await setUp();
    const path = await recordPath(root);
    await session(root, "startup", "first");
    const target = join(root, "..", "target.json");
    await Deno.writeTextFile(target, "untouched\n");
    await Deno.symlink(target, path);
    assertEquals((await session(root, "startup")).code, 0);
    assertEquals(await Deno.readTextFile(target), "untouched\n");
    assertEquals((await Deno.lstat(path)).isSymlink, true, "kept, and refused when read");
  },
});

Deno.test({
  name: "a record folder that is a link is refused, and nothing is written through it",
  ignore: !POSIX,
  fn: async () => {
    const { root } = await setUp();
    const gitDir = (await git(root, "rev-parse", "--absolute-git-dir")).trim();
    const elsewhere = await Deno.makeTempDir({ prefix: "elsewhere-" });
    await Deno.remove(join(gitDir, "specnaut"), { recursive: true }); // the fixture's own session
    await Deno.symlink(elsewhere, join(gitDir, "specnaut"));
    const run = await session(root, "startup");
    assertEquals([run.code, run.stdout, run.env], [1, "", ""]);
    assertStringIncludes(run.stderr, "a link is not followed");
    assertEquals([...Deno.readDirSync(elsewhere)], []);
  },
});

Deno.test("an input that is not a SessionStart hook's, or no CLAUDE_ENV_FILE, is a usage error", async () => {
  const { root } = await setUp();
  const cases: [string, Record<string, string>, string][] = [
    ["{not json", { CLAUDE_ENV_FILE: "/dev/null" }, "names no session id and source"],
    [JSON.stringify({ source: "startup" }), { CLAUDE_ENV_FILE: "/dev/null" }, "no session id"],
    [JSON.stringify({ session_id: "../x", source: "startup" }), {}, "no session id"],
    [
      JSON.stringify({ session_id: ID, source: "startup" }),
      { CLAUDE_ENV_FILE: "" },
      "CLAUDE_ENV_FILE",
    ],
  ];
  for (const [stdin, env, says] of cases) {
    const run = await runSpecnaut(["record-checkout"], { cwd: root, stdin, env });
    assertEquals([run.code, run.stdout], [2, ""], stdin);
    assertStringIncludes(run.stderr, says);
  }
  assertEquals(await exists(await recordPath(root)), false);
});

Deno.test("a folder in no git repository records nothing and says nothing", async () => {
  const dir = await Deno.makeTempDir({ prefix: "no-repo-" });
  const run = await session(dir, "startup");
  assertEquals([run.code, run.stdout, said(run.stderr), run.env], [0, "", false, ""]);
});

Deno.test("an argument is refused by the parser", async () => {
  const run = await runSpecnaut(["record-checkout", "extra"]);
  assertEquals(run.code, 2);
  assertStringIncludes(run.stderr, "record-checkout takes no argument");
});

Deno.test("only Claude Code is scaffolded the hook that takes the record; every other harness takes none", () => {
  for (const harness of ["claude", "codex", "copilot", "cursor", "opencode", "antigravity"]) {
    const lock = parseLock(LOCK.replace("harness: claude", `harness: ${harness}`));
    const files = bundleForLock(CORE_BUNDLE, lock, findHarness)!;
    const calling = Object.entries(files)
      .filter(([, f]) => f.content.includes("record-checkout"))
      .map(([path]) => path)
      .sort();
    const expected = harness === "claude"
      ? [".claude/hooks/record-checkout.sh", ".claude/settings.json"]
      : [];
    assertEquals(calling, expected, harness);
  }
});
