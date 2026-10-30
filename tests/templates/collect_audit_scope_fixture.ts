import { assert } from "@std/assert";
import { fromFileUrl } from "@std/path";

/**
 * The throwaway-repo fixture the `collect-audit-scope.sh` behaviour tests share.
 * Split out of `collect_audit_scope_test.ts` so the signal cases can live in a
 * file of their own without a second copy of the harness: one fixture, one
 * definition of how the script is run.
 */

const SCRIPT = fromFileUrl(
  new URL(
    "../../templates/core/skills/task/scripts/collect-audit-scope.sh",
    import.meta.url,
  ),
);

/** Runs a command in `cwd`, returning {code, stdout, stderr}. */
async function run(
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const out = await new Deno.Command(cmd, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
    env: { ...env },
  }).output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

/** git with deterministic identity + no global config bleed-through. */
export async function git(args: string[], cwd: string): Promise<void> {
  const r = await run("git", args, cwd, {
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
    HOME: cwd,
  });
  if (r.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
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
  return await run("bash", [SCRIPT, ...args], dir, { HOME: dir });
}

/** Parses an `KEY: value` integer count line from the block. */
export function count(block: string, key: string): number {
  const m = block.match(new RegExp(`^${key}: (\\d+)$`, "m"));
  assert(m, `expected a "${key}: <int>" line in:\n${block}`);
  return Number(m[1]);
}
