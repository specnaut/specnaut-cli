import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  bashPath,
  type Harness,
  HOOKS_DIR,
  makeRepo,
  payload,
  type Run,
  runHook,
  runScript,
  sandbox,
  stamps,
} from "./hook_sandbox.ts";
import { gitBash, pathWithCrlfJq } from "./hook_path.ts";

/**
 * What a Windows harness hands the guards, run through the real scripts.
 *
 * A native jq.exe writes stdout in text mode, every `\n` as `\r\n`; and Claude
 * Code and Codex on Windows send `C:\…` paths, which no POSIX test calls
 * absolute — so every guard refused every call. Both are reproduced here on
 * any OS: a jq wrapper that writes CRLF, and Git Bash's own `OSTYPE` with a
 * `cygpath` stand-in (on Windows, the real one).
 */

const WINDOWS = Deno.build.os === "windows";

function verdict(r: Run): string {
  if (r.code === 2) return "deny";
  if (r.code === 0 && r.stdout === "") return "allow";
  if (r.code === 0 && JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision === "ask") {
    return "ask";
  }
  return `unexpected exit ${r.code}: ${r.stdout} ${r.stderr}`;
}

type Case = [hook: string, harness: Harness, fixture: string, input: unknown, want: string];

const bashCmd = (command: string) => ({ command });

const CASES: readonly Case[] = [
  // Each line but the last came back from jq.exe with a \r: `main\r` is no base
  // branch, and `v1.2.3\r` no ref name — both used to read as nothing to gate.
  [
    "guard-merge.sh",
    "claude",
    "pre_tool_use_bash",
    bashCmd("git push origin main\ngit status"),
    "ask",
  ],
  [
    "guard-release.sh",
    "codex",
    "pre_tool_use_bash",
    bashCmd("git push origin v1.2.3\ngit status"),
    "deny",
  ],
  [
    "guard-merge.sh",
    "claude",
    "pre_tool_use_bash",
    bashCmd("cat <<EOF\nhi\nEOF\ngit status\n"),
    "allow",
  ],
  // A \r the command carries itself is kept: dropped, `\r#` would start a
  // comment the shell never sees, and hide the push behind it.
  [
    "guard-merge.sh",
    "claude",
    "pre_tool_use_bash",
    bashCmd("echo \r# ; git push origin main"),
    "ask",
  ],
  [
    "protect-generated.sh",
    "codex",
    "pre_tool_use_apply_patch",
    bashCmd(
      "*** Begin Patch\n*** Update File: .specnaut/installed.lock\n@@\n-a\n+b\n*** End Patch\n",
    ),
    "deny",
  ],
  [
    "guard-dispatch-model.sh",
    "claude",
    "pre_tool_use_agent",
    { subagent_type: "architect-expert", model: "haiku" },
    "deny",
  ],
];

Deno.test("a jq that writes CRLF, as its Windows build does, changes no guard's decision", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { head: "feat", mode: "manual" });
    const crlf = { PATH: await pathWithCrlfJq(sb) };
    const wrong: string[] = [];
    for (const [hook, harness, fixture, input, want] of CASES) {
      const p = await payload(harness, fixture, { cwd: repo, tool_input: input });
      for (const [label, env] of [["jq", {}], ["CRLF jq", crlf]] as const) {
        const got = verdict(await runHook(sb, hook, harness, p, { env }));
        if (got !== want) {
          wrong.push(`${label} ${hook} ${JSON.stringify(input)}: want ${want}, got ${got}`);
        }
      }
    }
    assertEquals(wrong, []);

    // The approval round trip: minted, written and read back through jq.exe.
    await runHook(
      sb,
      "approve-on-prompt.sh",
      "codex",
      await payload("codex", "user_prompt_submit", { cwd: repo }),
      { env: crlf },
    );
    assertEquals((await stamps(sb)).length, 1, "a CRLF jq still mints the stamp");
    const push = await payload("codex", "pre_tool_use_bash", {
      cwd: repo,
      tool_input: bashCmd("git push origin main"),
    });
    assertEquals(
      verdict(await runHook(sb, "guard-merge.sh", "codex", push, { env: crlf })),
      "allow",
    );
  } finally {
    await sb.cleanup();
  }
});

Deno.test("guard_jq undoes the \\r\\n guard_init measured, and nothing else", async () => {
  const sb = await sandbox();
  try {
    const probe = join(sb.dir, "probe.sh");
    await Deno.writeTextFile(
      probe,
      `. "${bashPath(join(HOOKS_DIR, "_guard.sh"))}"\nGUARD_JQ_CRLF=$1\n` +
        `printf '%s' '{"a":"x\\ny\\r\\nz"}' | guard_jq -r .a\nguard_allow\n`,
    );
    const env = { PATH: await pathWithCrlfJq(sb) };
    const run = (measured: string) =>
      runScript({ ...sb, env: { ...sb.env, ...env } }, probe, sb.dir, measured);
    // Measured: jq's own \r\n undone, the value's \r\n kept (jq.exe wrote it \r\r\n).
    assertEquals((await run("1")).stdout, "x\ny\r\nz\n");
    // Not measured (a jq that writes LF): byte for byte.
    assertEquals((await run("0")).stdout, "x\r\ny\r\r\nz\r\n");
  } finally {
    await sb.cleanup();
  }
});

Deno.test("a C:\\ cwd and file path, as a Windows harness sends them, are judged, not refused", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { mode: "auto" });
    await Deno.mkdir(join(repo, "src"));
    const { env, win } = await gitBash(sb);
    const edit = async (cwd: string, file: string) =>
      runHook(
        sb,
        "protect-generated.sh",
        "claude",
        await payload("claude", "pre_tool_use_edit", {
          cwd: win(cwd),
          tool_input: { file_path: file },
        }),
        { env },
      );

    const lock = await edit(repo, win(join(repo, ".specnaut", "installed.lock")));
    assertEquals(lock.code, 2, lock.stderr);
    assertStringIncludes(
      lock.stderr,
      "is .specnaut/installed.lock",
      "refused as the lock, not as a path",
    );
    assertEquals(verdict(await edit(repo, win(join(repo, "src", "app.ts")))), "allow");
    assertEquals(verdict(await edit(join(repo, "src"), "..\\.specnaut\\installed.lock")), "deny");
    assertEquals(verdict(await edit(join(repo, "src"), "app.ts")), "allow");

    // The approval store honours a Windows XDG_STATE_HOME too.
    const p = await payload("codex", "user_prompt_submit", { cwd: win(repo) });
    await runHook(sb, "approve-on-prompt.sh", "codex", p, {
      env: { ...env, XDG_STATE_HOME: win(sb.state) },
    });
    assertEquals((await stamps(sb)).length, 1, "minted under XDG_STATE_HOME");
  } finally {
    await sb.cleanup();
  }
});

// Ignored on Windows, where it cannot hold: there a `\` IS a separator and
// C: a drive. Reported as ignored, never as a silent pass.
Deno.test({
  name: "off Windows, a backslash is a filename character and C: no drive",
  ignore: WINDOWS,
  fn: async () => {
    const sb = await sandbox();
    try {
      const repo = await makeRepo(sb, { mode: "auto" });
      const p = await payload("claude", "pre_tool_use_edit", {
        cwd: repo,
        tool_input: { file_path: "C:\\x\\.specnaut\\installed.lock" },
      });
      // A file named that, in the cwd: not the lock.
      assertEquals(verdict(await runHook(sb, "protect-generated.sh", "claude", p)), "allow");
      const bad = await payload("claude", "pre_tool_use_edit", { cwd: `C:${repo}` });
      assertStringIncludes(
        (await runHook(sb, "protect-generated.sh", "claude", bad)).stderr,
        "is not absolute",
      );
    } finally {
      await sb.cleanup();
    }
  },
});

Deno.test("log-subagent records a CRLF jq's fields without the \\r", async () => {
  const sb = await sandbox();
  try {
    const child = new Deno.Command("bash", {
      args: [bashPath(join(HOOKS_DIR, "log-subagent.sh")), "stop"],
      cwd: sb.dir,
      env: { ...sb.env, PATH: await pathWithCrlfJq(sb) },
      clearEnv: true,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const w = child.stdin.getWriter();
    await w.write(new TextEncoder().encode(JSON.stringify({
      session_id: "s1",
      agent_type: "architect-expert",
      agent_id: "a1",
      effort: { level: "high" },
      last_assistant_message: "WORKFLOW STATUS\nSTATE: done\nDONE_CRITERIA_MET: yes\n",
    })));
    await w.close();
    assertEquals((await child.output()).code, 0);
    const line = JSON.parse(
      await Deno.readTextFile(join(sb.dir, ".specnaut", "logs", "agents.jsonl")),
    );
    const { session, agent, agent_id, effort, state, done_criteria_met } = line;
    assertEquals(
      { session, agent, agent_id, effort, state, done_criteria_met },
      {
        session: "s1",
        agent: "architect-expert",
        agent_id: "a1",
        effort: "high",
        state: "done",
        done_criteria_met: "yes",
      },
    );
  } finally {
    await sb.cleanup();
  }
});
