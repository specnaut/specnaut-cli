import { assert } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { IDENTITY, run } from "./child_fixture.ts";

/**
 * The throwaway-repo fixture the `collect-audit-scope.sh` behaviour tests share.
 * Split out of `collect_audit_scope_test.ts` so the signal cases can live in a
 * file of their own without a second copy of the harness: one fixture, one
 * definition of how the script is run.
 */

export const SCOPE_SOURCE = fromFileUrl(
  new URL("../../templates/core/skills/task/scripts/collect-audit-scope.sh", import.meta.url),
);
const SCRIPTS_BASH = "../../templates/core/specnaut/scripts/bash/";
const LIBRARY = [
  "_git_untrusted.sh",
  "_git_manifests.sh",
  "_scope_globs.sh",
  "_explicit_head.sh",
  "_audit_scopes.sh",
];

/**
 * The script runs from a folder laid out as `init` installs it: the git library
 * and the globs it sources beside it, as the manifest puts them all under
 * `.specnaut/scripts/audit/`.
 */
const INSTALLED = await Deno.makeTempDir({ prefix: "code-audit-scripts-" });
await Deno.copyFile(SCOPE_SOURCE, join(INSTALLED, "collect-audit-scope.sh"));
for (const name of LIBRARY) {
  await Deno.copyFile(
    fromFileUrl(new URL(SCRIPTS_BASH + name, import.meta.url)),
    join(INSTALLED, name),
  );
}
globalThis.addEventListener("unload", () => Deno.removeSync(INSTALLED, { recursive: true }));
const SCRIPT = join(INSTALLED, "collect-audit-scope.sh");

/** git with the shared identity, in the shared child environment; never throws. */
export function gitRun(args: string[], cwd: string, stdin?: string) {
  return run("git", args, cwd, IDENTITY, stdin);
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
  extra: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  // On Windows the MSYS runtime expands a wildcard in the arguments a native process hands bash
  // (`*.json` arrives as `deno.json`); `noglob` passes them through as an agent's shell would.
  const env: Record<string, string> = { ...extra };
  if (Deno.build.os === "windows") env.MSYS = "noglob";
  return await run("bash", [SCRIPT, ...args], dir, env);
}

/** Parses an `KEY: value` integer count line from the block. */
export function count(block: string, key: string): number {
  const m = block.match(new RegExp(`^${key}: (\\d+)$`, "m"));
  assert(m, `expected a "${key}: <int>" line in:\n${block}`);
  return Number(m[1]);
}
