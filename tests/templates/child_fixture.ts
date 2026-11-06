/**
 * The one way the git and scope-script tests start a child process. The child
 * inherits the parent's environment minus every GIT_* variable, reads no system
 * git config, and has HOME at its working directory, so neither the developer's
 * git setup nor a variable git exported into the test run reaches a fixture.
 * `env` is applied last: a case that sets a GIT_* variable on purpose keeps it.
 */

export type Result = { code: number; stdout: string; stderr: string };

/** A deterministic author and committer for every fixture commit. */
export const IDENTITY = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function childEnv(cwd: string, env: Record<string, string>): Record<string, string> {
  const base = Object.fromEntries(
    Object.entries(Deno.env.toObject()).filter(([k]) => !k.toUpperCase().startsWith("GIT_")),
  );
  return { ...base, GIT_CONFIG_NOSYSTEM: "1", HOME: cwd, ...env };
}

/** Runs `cmd` in `cwd`; never throws on a non-zero exit. */
export async function run(
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
  stdin?: string,
): Promise<Result> {
  const child = new Deno.Command(cmd, {
    args,
    cwd,
    clearEnv: true,
    env: childEnv(cwd, env),
    stdin: stdin === undefined ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  if (stdin !== undefined) {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(stdin));
    await writer.close();
  }
  const out = await child.output();
  const d = new TextDecoder();
  return { code: out.code, stdout: d.decode(out.stdout), stderr: d.decode(out.stderr) };
}
