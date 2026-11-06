import { assert } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/**
 * The throwaway-repo fixture the `collect-audit-scope.sh` behaviour tests share.
 * Split out of `collect_audit_scope_test.ts` so the signal cases can live in a
 * file of their own without a second copy of the harness: one fixture, one
 * definition of how the script is run.
 */

export const SCOPE_SOURCE = fromFileUrl(
  new URL("../../templates/core/skills/task/scripts/collect-audit-scope.sh", import.meta.url),
);
const LIBRARY = fromFileUrl(
  new URL("../../templates/core/specnaut/scripts/bash/_git_untrusted.sh", import.meta.url),
);

/**
 * The script runs from a folder laid out as `init` installs it: the git library
 * beside it, as the manifest puts both under `.specnaut/scripts/audit/`.
 */
const INSTALLED = await Deno.makeTempDir({ prefix: "code-audit-scripts-" });
await Deno.copyFile(SCOPE_SOURCE, join(INSTALLED, "collect-audit-scope.sh"));
await Deno.copyFile(LIBRARY, join(INSTALLED, "_git_untrusted.sh"));
globalThis.addEventListener("unload", () => Deno.removeSync(INSTALLED, { recursive: true }));
const SCRIPT = join(INSTALLED, "collect-audit-scope.sh");

/** Runs a command in `cwd`, returning {code, stdout, stderr}. */
async function run(
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
  stdin?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = new Deno.Command(cmd, {
    args,
    cwd,
    stdin: stdin === undefined ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
    env: { ...env },
  }).spawn();
  if (stdin !== undefined) await writeStdin(child, stdin);
  const out = await child.output();
  const d = new TextDecoder();
  return { code: out.code, stdout: d.decode(out.stdout), stderr: d.decode(out.stderr) };
}

async function writeStdin(child: Deno.ChildProcess, text: string): Promise<void> {
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(text));
  await writer.close();
}

/** git with deterministic identity + no global config bleed-through; never throws. */
export function gitRun(args: string[], cwd: string, stdin?: string) {
  const env = {
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
    HOME: cwd,
  };
  return run("git", args, cwd, env, stdin);
}

/** `gitRun`, its stdout, or a throw naming git's error. */
export async function git(args: string[], cwd: string, stdin?: string): Promise<string> {
  const r = await gitRun(args, cwd, stdin);
  if (r.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
  return r.stdout;
}

/** Builds a temp git repo with a frontend file, a backend file, and a deno.json. */
export async function fixtureRepo(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "code-audit-scope-" });
  await git(["init", "-b", "main"], dir);
  await Deno.mkdir(`${dir}/src`, { recursive: true });
  await Deno.writeTextFile(`${dir}/src/Button.tsx`, "export const Button = () => null;\n");
  await Deno.writeTextFile(`${dir}/src/service.ts`, "export const svc = () => 1;\n");
  await Deno.writeTextFile(`${dir}/deno.json`, "{}\n");
  await git(["add", "."], dir);
  await git(["commit", "-m", "feat: initial fixtures"], dir);
  return dir;
}

export async function scope(
  dir: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  // On Windows the MSYS runtime expands a wildcard in the arguments a native process hands bash
  // (`*.json` arrives as `deno.json`); `noglob` passes them through as an agent's shell would.
  const env: Record<string, string> = { HOME: dir };
  if (Deno.build.os === "windows") env.MSYS = "noglob";
  return await run("bash", [SCRIPT, ...args], dir, env);
}

/** Parses an `KEY: value` integer count line from the block. */
export function count(block: string, key: string): number {
  const m = block.match(new RegExp(`^${key}: (\\d+)$`, "m"));
  assert(m, `expected a "${key}: <int>" line in:\n${block}`);
  return Number(m[1]);
}
