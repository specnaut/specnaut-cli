import { fromFileUrl, join } from "@std/path";

/**
 * The `PreToolUse` hook that runs `specnaut review guard`, as Claude Code runs it: its input on
 * stdin. A stub `specnaut` first on the PATH stands for the binary and says what it was given.
 */

export const HOOK = fromFileUrl(
  new URL("../../templates/harness-specific/claude/hooks/review-lock.sh", import.meta.url),
);

/** The lock's per-user copies for these tests, never the user's own. */
export const STATE = Deno.makeTempDirSync({ prefix: "review-lock-state-" });
globalThis.addEventListener("unload", () => Deno.removeSync(STATE, { recursive: true }));
export const COPIES = join(STATE, "specnaut", "review-lock");

/** What a run may add: variables over the defaults, and the folder it starts in. */
export type HookRun = { readonly env?: Record<string, string>; readonly cwd?: string };

export async function runHook(
  project: string,
  input: string,
  stubExit = 0,
  path?: string,
  more: HookRun = {},
) {
  const bin = await Deno.makeTempDir({ prefix: "review-lock-bin-" });
  try {
    const seen = join(bin, "seen");
    const stub = `#!/usr/bin/env bash\n{ echo "$*"; cat; } >"${seen}"\nexit ${stubExit}\n`;
    await Deno.writeTextFile(join(bin, "specnaut"), stub, { mode: 0o755 });
    const env = {
      PATH: path ?? `${bin}:${Deno.env.get("PATH")}`,
      CLAUDE_PROJECT_DIR: project,
      XDG_STATE_HOME: STATE,
      ...more.env,
    };
    const child = new Deno.Command("bash", {
      args: [HOOK],
      env,
      cwd: more.cwd,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(input));
    await writer.close();
    const { code } = await child.output();
    return { code, called: await Deno.readTextFile(seen).catch(() => null) };
  } finally {
    await Deno.remove(bin, { recursive: true });
  }
}

export const input = (session: string) =>
  JSON.stringify({ session_id: session, tool_name: "Bash", tool_input: { command: "git push" } });

export async function inProject(fn: (project: string, locks: string) => Promise<void>) {
  const project = await Deno.makeTempDir({ prefix: "review-lock-project-" });
  try {
    await new Deno.Command("git", { args: ["init", "-q", project] }).output();
    await fn(project, join(project, ".git", "specnaut", "review-lock"));
  } finally {
    await Deno.remove(project, { recursive: true });
  }
}
