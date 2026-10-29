import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { HOOKS_DIR } from "./hook_sandbox.ts";

/**
 * A CRLF checkout of the installed hooks (core.autocrlf on Windows) puts a
 * `\r` on every line of the lists the guards read. Read as is, nothing in
 * release-commands.txt matched, so every release command was allowed, and no
 * Specnaut agent matched _agents.txt, so a model override went through. The
 * .gitattributes beside the hooks prevents the conversion; the guards also
 * read past it.
 */

async function crlfHooks(): Promise<string> {
  const repo = await Deno.makeTempDir({ prefix: "crlf-lists-" });
  await new Deno.Command("git", { args: ["init", "-q"], cwd: repo }).output();
  const hooks = join(repo, ".specnaut", "hooks");
  await Deno.mkdir(hooks, { recursive: true });
  for await (const e of Deno.readDir(HOOKS_DIR)) {
    if (!e.isFile) continue;
    const text = await Deno.readTextFile(join(HOOKS_DIR, e.name));
    const crlf = e.name.endsWith(".txt") ? text.replaceAll("\n", "\r\n") : text;
    await Deno.writeTextFile(join(hooks, e.name), crlf);
  }
  return repo;
}

async function run(repo: string, script: string, payload: unknown): Promise<number> {
  const p = new Deno.Command("bash", {
    args: [join(repo, ".specnaut", "hooks", script).replaceAll("\\", "/"), "codex"],
    cwd: repo,
    stdin: "piped",
    stdout: "null",
    stderr: "null",
    env: { XDG_STATE_HOME: join(repo, "state"), HOME: repo },
  }).spawn();
  const w = p.stdin.getWriter();
  await w.write(new TextEncoder().encode(JSON.stringify(payload)));
  await w.close();
  return (await p.output()).code;
}

const base = (repo: string) => ({
  session_id: "s1",
  turn_id: "t1",
  cwd: repo,
  hook_event_name: "PreToolUse",
  model: "m",
  permission_mode: "default",
  transcript_path: null,
  tool_use_id: "u1",
});

Deno.test("a CRLF release-commands.txt still gates every release command (Codex)", async () => {
  const repo = await crlfHooks();
  try {
    for (const command of ["release-github.sh v1.2.3", "gh release create v1.2.3"]) {
      const code = await run(repo, "guard-release.sh", {
        ...base(repo),
        tool_name: "Bash",
        tool_input: { command },
      });
      assertEquals(code, 2, command);
    }
    const noPush = await run(repo, "guard-release.sh", {
      ...base(repo),
      tool_name: "Bash",
      tool_input: { command: "tag.sh --no-push" },
    });
    assertEquals(noPush, 0, "the except clause still reads past the \\r");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("a CRLF _agents.txt still refuses a model override on a Specnaut agent (Codex)", async () => {
  const repo = await crlfHooks();
  try {
    const code = await run(repo, "guard-dispatch-model.sh", {
      ...base(repo),
      tool_name: "spawn_agent",
      tool_input: { agent_type: "architect-expert", model: "cheap" },
    });
    assertEquals(code, 2);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});
