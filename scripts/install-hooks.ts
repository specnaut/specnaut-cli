// Installs `hooks/pre-commit` into the repository's hooks directory. Run via
// `deno task setup`. Idempotent.
//
// What gets installed is a SHIM, not a symlink to the hook. The shim asks git
// for the worktree root at run time and execs `hooks/pre-commit` from there.
//
// The previous shape wrote an absolute symlink, whose text was the path the
// checkout occupied at install time. Move or rename the directory and the link
// dangles — and git `stat()`s THROUGH a symlink, so a dangling hook is
// indistinguishable from no hook at all. Commits keep succeeding with none of
// the four gates run, and nothing anywhere says so. That is not hypothetical:
// in a maintainer checkout the link pointed into a directory renamed away, and
// the hook was inert for close to four months (#591).
//
// A shim resolves at run time, so it survives any move of the checkout without
// being reinstalled.

import { fromFileUrl, resolve } from "@std/path";
import { shimContent } from "./install-hooks-shim.ts";
import { classifyHook, type HookState, installProblems } from "./install-hooks-state.ts";

const ROOT = fromFileUrl(new URL("..", import.meta.url));

// Resolve the real hooks directory via `git rev-parse --git-path hooks`.
// We can't hardcode `<repo>/.git/hooks` because that path is wrong when the
// repo is checked out as a git submodule — there `.git` is a *gitdir file*
// (`gitdir: ../../.git/modules/<name>`) pointing at the parent repo's
// `.git/modules/<name>/`, and the real hooks live there (#335). Letting
// git answer keeps the script correct in both layouts.
export async function resolveHooksDir(cwd: string): Promise<string> {
  const out = await new Deno.Command("git", {
    args: ["rev-parse", "--git-path", "hooks"],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) {
    throw new Error(
      `error: not a git repository (\`git rev-parse\` failed in ${cwd}): ${
        new TextDecoder().decode(out.stderr).trim()
      }`,
    );
  }
  return resolve(cwd, new TextDecoder().decode(out.stdout).trim());
}

export type InstallResult = {
  ok: boolean;
  /** Exit code `main()` should use. */
  code: number;
  lines: string[];
};

/**
 * Install, upgrade or repair the pre-commit hook for the checkout at
 * `repoRoot`. Never assumes its own success: the last thing it does is check
 * that the thing it just wrote can actually reach a runnable hook.
 */
export async function installPreCommitHook(repoRoot: string): Promise<InstallResult> {
  const source = resolve(repoRoot, "hooks/pre-commit");
  const hooksDir = await hooksDirOf(repoRoot);
  if (typeof hooksDir !== "string") return hooksDir;
  const target = resolve(hooksDir, "pre-commit");
  await Deno.mkdir(hooksDir, { recursive: true });
  const state = await classifyHook(target, source);
  if (state.kind === "foreign") return refuseForeign(target, state.detail);
  const lines = [...replacing(state), await writeShim(state, target)];
  const problems = await installProblems(target, source);
  if (problems.length > 0) {
    return { ok: false, code: 3, lines: [...lines, ...problems.map((p) => `error: ${p}`)] };
  }
  lines.push(`  it runs ${source} via \`git rev-parse --show-toplevel\`, so a`);
  lines.push("  move of this checkout does not need another `deno task setup`");
  return { ok: true, code: 0, lines };
}

/** The hooks folder git names, or the failure to find one as the install's result. */
async function hooksDirOf(repoRoot: string): Promise<string | InstallResult> {
  try {
    return await resolveHooksDir(repoRoot);
  } catch (e) {
    return { ok: false, code: 1, lines: [e instanceof Error ? e.message : String(e)] };
  }
}

/** A hook this script did not write is never replaced: the user backs it up first. */
function refuseForeign(target: string, detail: string): InstallResult {
  return {
    ok: false,
    code: 2,
    lines: [
      `error: ${target} exists and was not installed by this script ` +
      `(${detail}). Back it up and re-run.`,
    ],
  };
}

type Replaceable = Exclude<HookState, { kind: "foreign" }>;

/** What the install is about to replace, said before it does. */
function replacing(state: Replaceable): string[] {
  if (state.kind === "legacy-symlink") {
    return [
      state.dangling
        ? `  replacing a dangling symlink → ${state.link} (the target does not exist)`
        : `  replacing the old absolute symlink → ${state.link}`,
    ];
  }
  if (state.kind === "ours-shim" && !state.current) {
    return ["  refreshing a shim written by an older version"];
  }
  return [];
}

/** Writes the shim unless the current one is already there; the line that says which. */
async function writeShim(state: Replaceable, target: string): Promise<string> {
  if (state.kind === "ours-shim" && state.current) return "✓ pre-commit shim already installed";
  // `remove` first: writing over a symlink follows it and would clobber the
  // tracked hook itself.
  if (state.kind === "legacy-symlink") await Deno.remove(target);
  await Deno.writeTextFile(target, shimContent());
  await Deno.chmod(target, 0o755);
  return `✓ installed pre-commit shim at ${target}`;
}

async function main() {
  const result = await installPreCommitHook(ROOT);
  for (const line of result.lines) {
    (result.ok ? console.log : console.error)(line);
  }
  if (!result.ok) Deno.exit(result.code);
}

if (import.meta.main) await main();
