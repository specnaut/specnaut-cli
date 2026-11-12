import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { sha256HexBytes } from "../../src/domain/sha256.ts";
import { runSpecnaut } from "../helpers/run_specnaut.ts";
import { BASE_FILES, SETTINGS, setUp } from "./verify_checkout_fixture.ts";
import { git, write } from "./verify_scripts_fixture.ts";

/**
 * `specnaut record-checkout`, black-box, as the `SessionStart` hook runs it: the hook's input on
 * stdin, `CLAUDE_ENV_FILE` naming the file the harness sources before the session's commands. The
 * record is found by the session id alone, so nothing is ever written to that file.
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

const gitDir = async (root: string) => (await git(root, "rev-parse", "--absolute-git-dir")).trim();

/** Where the record of session `id` lives: the worktree's own git directory, never the tree. */
async function recordPath(root: string, id = ID): Promise<string> {
  return join(await gitDir(root), "specnaut", "session", `${id}.json`);
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
  assertEquals(record.version, 3);
  assertEquals(record.head, (await git(root, "rev-parse", "HEAD")).trim());
  const reflog = await Deno.readFile(join(await gitDir(root), "logs", "HEAD"));
  const mark = { bytes: reflog.length, sha256: await sha256HexBytes(reflog) };
  assertEquals(record.reflog, mark, "HEAD's reflog as the session started");
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
  assertEquals(run.env, "", "nothing exported to the session");
  const status = await git(root, "status", "--porcelain", "--ignored", "--untracked-files=all");
  assertEquals(status.includes("session"), false, "nothing written in the work tree");
});

Deno.test("startup takes the record; resume and fork only find it; clear and compact keep it as it was", async () => {
  const { root } = await setUp();
  const path = await recordPath(root);
  for (const source of ["resume", "fork"]) {
    const run = await session(root, source);
    assertEquals([run.code, run.stdout, run.env], [1, "", ""], source);
    assertStringIncludes(run.stderr, "this session has no first record: start a new session");
    assertEquals(await exists(path), false, `${source} takes none`);
  }
  const run = await session(root, "startup");
  assertEquals(run.code, 0);
  assert(await exists(path), "startup takes a record");
  assertEquals(run.env, "", "nothing exported to the session");
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
    assertEquals(run.env, "", `${source} exports nothing`);
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

Deno.test("an input that is not a SessionStart hook's is a usage error; CLAUDE_ENV_FILE is not needed", async () => {
  const { root } = await setUp();
  const cases: [string, string][] = [
    ["{not json", "names no session id and source"],
    [JSON.stringify({ source: "startup" }), "no session id"],
    [JSON.stringify({ session_id: "../x", source: "startup" }), "no session id"],
  ];
  for (const [stdin, says] of cases) {
    const run = await runSpecnaut(["record-checkout"], { cwd: root, stdin, env: {} });
    assertEquals([run.code, run.stdout], [2, ""], stdin);
    assertStringIncludes(run.stderr, says);
  }
  assertEquals(await exists(await recordPath(root)), false);
  const stdin = JSON.stringify({ session_id: ID, source: "startup" });
  const run = await runSpecnaut(["record-checkout"], {
    cwd: root,
    stdin,
    env: { CLAUDE_ENV_FILE: "" },
  });
  assertEquals([run.code, said(run.stderr)], [0, false]);
  assert(await exists(await recordPath(root)), "taken with no CLAUDE_ENV_FILE");
});

Deno.test("a checkout whose HEAD has no reflog takes no record, saying why", async () => {
  const { root } = await setUp();
  await Deno.remove(join(await gitDir(root), "logs", "HEAD"));
  const run = await session(root, "startup");
  assertEquals([run.code, run.stdout, run.env], [1, "", ""]);
  assertStringIncludes(run.stderr, "HEAD has no reflog");
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
