import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { FsReviewLock } from "../../src/infrastructure/fs_review_lock.ts";
import { COPIES, HOOK, inProject, STATE } from "./review_lock_hook_fixture.ts";

/**
 * The review lock's hook end to end, the real script running the real binary, on the input
 * Claude Code gives a `PreToolUse` hook and judged by the output it acts on: exit 0 runs the call,
 * exit 2 stops it and shows the session stderr. A run on Claude Code itself is not stood in for:
 * these pin both sides of the contract as this code reads and writes it.
 */

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));
const SHA = "a".repeat(40);
const POSIX = Deno.build.os !== "windows";

/** Claude Code's `PreToolUse` input, `session_id` first, every field it carries beside the tool. */
function payload(session: string, tool: string, toolInput: unknown, more: object = {}) {
  return JSON.stringify({
    session_id: session,
    transcript_path: "/home/u/.claude/projects/p/s.jsonl",
    cwd: "/home/u/p",
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: tool,
    tool_input: toolInput,
    tool_use_id: "toolu_01",
    ...more,
  });
}

/** The hook in `project`, `specnaut` on its PATH being this checkout's binary. */
async function hook(project: string, input: string) {
  const bin = await Deno.makeTempDir({ prefix: "review-lock-payload-bin-" });
  try {
    const run = `#!/usr/bin/env bash\nexec "${Deno.execPath()}" run -q --allow-read ` +
      `--allow-write --allow-run --allow-env "${MAIN}" "$@"\n`;
    await Deno.writeTextFile(join(bin, "specnaut"), run, { mode: 0o755 });
    const path = `${bin}:${Deno.env.get("PATH")}`;
    return await bash(input, { PATH: path, CLAUDE_PROJECT_DIR: project, XDG_STATE_HOME: STATE });
  } finally {
    await Deno.remove(bin, { recursive: true });
  }
}

/** The hook script run by bash under `env`, `input` on its stdin: its exit code and output. */
async function bash(input: string, env: Record<string, string>) {
  const child = new Deno.Command("bash", {
    args: [HOOK],
    env: { ...env, NO_COLOR: "1" },
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(input));
  await writer.close();
  const out = await child.output();
  const text = (b: Uint8Array) => new TextDecoder().decode(b);
  return { code: out.code, out: text(out.stdout), err: text(out.stderr) };
}

async function locked(project: string, session: string) {
  const lock = await FsReviewLock.open(project, { state: COPIES });
  await lock.lock(session);
  await lock.record(session, { head: SHA, logs: join(project, "logs") });
}

Deno.test({
  name: "a locked session's call is stopped with exit 2, its reason on stderr, stdout empty",
  ignore: !POSIX,
  fn: () =>
    inProject(async (project) => {
      await locked(project, "s-hp1");
      const push = await hook(project, payload("s-hp1", "Bash", { command: "git push" }));
      assertEquals([push.code, push.out], [2, ""]);
      assertStringIncludes(push.err, "`git push` is refused under the review lock");
      for (const [tool, input] of [["Read", { file_path: "/x" }], ["TodoWrite", { todos: [] }]]) {
        const ran = await hook(project, payload("s-hp1", tool as string, input));
        assertEquals([ran.code, ran.out, ran.err], [0, "", ""], tool as string);
      }
    }),
});

Deno.test({
  name: "a subagent's call is judged under the session id it carries; a new id is not locked",
  ignore: !POSIX,
  fn: () =>
    inProject(async (project) => {
      await locked(project, "s-hp2");
      const agent = { agent_id: "a-1", agent_type: "code-reviewer" };
      const edit = payload("s-hp2", "Edit", { file_path: "/x" }, agent);
      assertEquals((await hook(project, edit)).code, 2, "the parent's id, the parent's lock");
      const cleared = await hook(project, payload("s-hp3", "Edit", { file_path: "/x" }));
      assertEquals([cleared.code, cleared.err], [0, ""], "a session id the lock does not hold");
    }),
});

Deno.test({
  name: "a locked session's sandbox run is refused when it unsets or sets its session id first",
  ignore: !POSIX,
  fn: () =>
    inProject(async (project) => {
      const logs = join(project, "logs");
      await Deno.mkdir(logs);
      const lock = await FsReviewLock.open(project, { state: COPIES });
      await lock.lock("s-hp4");
      await lock.record("s-hp4", { head: SHA, logs: await Deno.realPath(logs) });
      const exec = `specnaut sandbox exec ${SHA} --log ${join(logs, "1.log")} -- make`;
      const call = (command: string) => hook(project, payload("s-hp4", "Bash", { command }));
      assertEquals((await call(exec)).code, 0, "the run's own shape");
      for (const prefix of ["env -u CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_SESSION_ID=x"]) {
        const run = await call(`${prefix} ${exec}`);
        assertEquals(run.code, 2, prefix);
        assertStringIncludes(run.err, "refused under the review lock", prefix);
      }
    }),
});
