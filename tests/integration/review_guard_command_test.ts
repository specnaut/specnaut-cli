import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import type { ReviewLock } from "../../src/application/review_ports.ts";
import { runReviewGuard } from "../../src/cli/handlers/review_guard_handler.ts";
import { FsReviewLock } from "../../src/infrastructure/fs_review_lock.ts";

/**
 * `specnaut review guard` as Claude Code runs it before a tool call, on a real repository: a
 * session the lock holds runs only what the lock allows, every other session runs anything, and
 * every way the guard fails stops the call with exit 2.
 */

const SHA = "a".repeat(40);
/** The lock's per-user copy, one folder for this file's tests, never the user's own. */
const STATE_ROOT = Deno.makeTempDirSync({ prefix: "review-guard-state-" });
const STATE = join(STATE_ROOT, "review-lock");
globalThis.addEventListener("unload", () => Deno.removeSync(STATE_ROOT, { recursive: true }));

async function guard(cwd: string, input: unknown, open?: (cwd: string) => Promise<ReviewLock>) {
  const said: string[] = [];
  const text = () => Promise.resolve(typeof input === "string" ? input : JSON.stringify(input));
  const code = await runReviewGuard({
    cwd,
    input: text,
    err: (s) => said.push(s),
    open: open ?? ((dir) => FsReviewLock.open(dir, { state: STATE })),
  });
  return { code, err: said.join("\n") };
}

const call = (session: string, tool: string, input: unknown) => ({
  session_id: session,
  hook_event_name: "PreToolUse",
  tool_name: tool,
  tool_input: input,
});

Deno.test("a locked session runs only what the lock allows; another session runs anything", async () => {
  const root = await Deno.makeTempDir({ prefix: "review-guard-" });
  try {
    await new Deno.Command("git", { args: ["init", "-q", root] }).output();
    const push = { command: "git push origin main" };
    assertEquals((await guard(root, call("s-1", "Bash", push))).code, 0, "no lock yet");
    await (await FsReviewLock.open(root, { state: STATE })).lock("s-1");
    const refused = await guard(root, call("s-1", "Bash", push));
    assertEquals(refused.code, 2);
    assertStringIncludes(refused.err, "review lock");
    assertEquals((await guard(root, call("s-1", "mcp__forge__merge", {}))).code, 2);
    assertEquals((await guard(root, call("s-1", "WebFetch", { url: "https://x" }))).code, 2);
    assertEquals((await guard(root, call("s-1", "Read", { file_path: "/x" }))).code, 0);
    const end = { command: `specnaut review end ${SHA}` };
    assertEquals((await guard(root, call("s-1", "Bash", end))).code, 2, "no head recorded yet");
    const lock = await FsReviewLock.open(root, { state: STATE });
    await lock.record("s-1", { head: SHA, logs: root });
    assertEquals((await guard(root, call("s-1", "Bash", end))).code, 0, "its own head");
    assertEquals((await guard(root, call("s-2", "Bash", push))).code, 0, "another session");
    assertEquals((await guard(root, "not json")).code, 2, "no session id: any lock holds");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("a locked session's sandboxed run logs only in its review's folder, found by real path", async () => {
  const root = await Deno.realPath(await Deno.makeTempDir({ prefix: "review-guard-log-" }));
  try {
    await new Deno.Command("git", { args: ["init", "-q", root] }).output();
    const logs = join(root, "cache", "logs");
    await Deno.mkdir(logs, { recursive: true });
    const lock = await FsReviewLock.open(root, { state: STATE });
    await lock.lock("s-1");
    // Quoted, as a shell needs it: a Windows path's backslashes are escapes when bare.
    const exec = (log: string) => ({
      command: `specnaut sandbox exec ${SHA} --log '${log}' -- deno task test`,
    });
    assertEquals((await guard(root, call("s-1", "Bash", exec(join(logs, "1.log"))))).code, 2);
    await lock.record("s-1", { head: SHA, logs });
    assertEquals((await guard(root, call("s-1", "Bash", exec(join(logs, "1.log"))))).code, 0);
    const outside = await guard(root, call("s-1", "Bash", exec(join(root, "1.log"))));
    assertEquals(outside.code, 2);
    assertStringIncludes(outside.err, "review lock");
    if (Deno.build.os !== "windows") {
      await Deno.symlink(root, join(logs, "up"));
      const through = exec(join(logs, "up", "1.log"));
      assertEquals((await guard(root, call("s-1", "Bash", through))).code, 2, "a link out");
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("a session locked in the per-user copy is refused where git finds no repository", async () => {
  const root = await Deno.makeTempDir({ prefix: "review-guard-copy-" });
  const bare = await Deno.makeTempDir({ prefix: "review-guard-bare-" });
  try {
    await new Deno.Command("git", { args: ["init", "-q", root] }).output();
    await (await FsReviewLock.open(root, { state: STATE })).lock("s-copy");
    const read = await guard(bare, call("s-copy", "Read", { file_path: "/x" }));
    assertEquals(read.code, 2);
    assertStringIncludes(read.err, "git cannot find this checkout's git directory");
    assertEquals((await guard(bare, call("s-free", "Bash", { command: "ls" }))).code, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(bare, { recursive: true });
  }
});

Deno.test("outside a repository no call is guarded, and a guard that throws refuses", async () => {
  const bare = await Deno.makeTempDir({ prefix: "review-guard-none-" });
  try {
    assertEquals((await guard(bare, call("s-out", "Bash", { command: "git push" }))).code, 0);
    const broken = await guard(bare, call("s-1", "Read", {}), () => {
      throw new Error("git is not on the PATH");
    });
    assertEquals(broken.code, 2);
    assertStringIncludes(broken.err, "git is not on the PATH");
    // A throw that is no Error refuses all the same, the value it threw as the reason.
    const thrown = await guard(bare, call("s-1", "Read", {}), () => Promise.reject(null));
    assertEquals(thrown.code, 2);
    assertStringIncludes(thrown.err, "the guard could not finish: null");
  } finally {
    await Deno.remove(bare, { recursive: true });
  }
});

Deno.test("a terminal on stdin is refused, naming what the guard reads", async () => {
  const said: string[] = [];
  const code = await runReviewGuard({
    cwd: ".",
    input: () => Promise.resolve(null),
    err: (s) => said.push(s),
    open: () => Promise.reject(new Error("unreached")),
  });
  assertEquals(code, 2);
  assertStringIncludes(said.join(""), "PreToolUse hook's input");
});
