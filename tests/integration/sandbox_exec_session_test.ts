import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { FsReviewLock } from "../../src/infrastructure/fs_review_lock.ts";

/**
 * `specnaut sandbox exec` learns the session it was started from in `CLAUDE_CODE_SESSION_ID`, as
 * Claude Code sets it in its shell, and then accepts a log only in that session's own folder.
 */

const MAIN = fromFileUrl(new URL("../../src/main.ts", import.meta.url));
const SHA = "a".repeat(40);

/**
 * `sandbox exec` in `repo`, its log in `log`, with `extra` beside a bare environment. Its export
 * cache is a folder of `repo`'s, so what it finds there is this test's alone. PATHEXT is kept: on
 * Windows, without it a program is not found on the PATH by its bare name, git included.
 */
async function exec(repo: string, log: string, extra: Record<string, string>) {
  const env: Record<string, string> = {
    NO_COLOR: "1",
    XDG_CACHE_HOME: join(repo, "cache"),
    ...extra,
  };
  for (const name of ["PATH", "PATHEXT", "HOME", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR"]) {
    const value = Deno.env.get(name);
    if (value !== undefined) env[name] = value;
  }
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "--allow-write", "--allow-run", "--allow-env", MAIN]
      .concat(["sandbox", "exec", SHA, "--log", log, "--", "true"]),
    cwd: repo,
    env,
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { code: out.code, err: new TextDecoder().decode(out.stderr) };
}

Deno.test("sandbox exec refuses its session a log in another session's folder", async () => {
  const repo = await Deno.realPath(await Deno.makeTempDir({ prefix: "sandbox-exec-session-" }));
  try {
    await new Deno.Command("git", { args: ["init", "-q", repo] }).output();
    const xdg = join(repo, "state");
    const lock = await FsReviewLock.open(repo, { state: join(xdg, "specnaut", "review-lock") });
    for (const id of ["s-1", "s-2"]) {
      await Deno.mkdir(join(repo, id));
      await lock.lock(id);
      await lock.record(id, { head: SHA, logs: join(repo, id) });
    }
    const log = join(repo, "s-2", "1.log");
    const mine = await exec(repo, log, { XDG_STATE_HOME: xdg, CLAUDE_CODE_SESSION_ID: "s-1" });
    assertEquals(mine.code, 125);
    assert(mine.err.includes("review lock"), mine.err);
    const unknown = await exec(repo, log, { XDG_STATE_HOME: xdg });
    // Past the lock, the export is looked up before any backend, on every host: Windows too.
    assert(unknown.err.includes(`no export of ${SHA}`), `past the lock: ${unknown.err}`);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});
