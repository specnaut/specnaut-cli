// Installs hooks/pre-commit into the repository's hooks directory as a
// symlink. Run via `deno task setup`. Idempotent.

import { resolve } from "@std/path";

const ROOT = new URL("..", import.meta.url).pathname;
const SOURCE = resolve(ROOT, "hooks/pre-commit");

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}

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

async function main() {
  let hooksDir: string;
  try {
    hooksDir = await resolveHooksDir(ROOT);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    Deno.exit(1);
  }
  const TARGET = resolve(hooksDir, "pre-commit");

  if (await exists(TARGET)) {
    const info = await Deno.lstat(TARGET);
    if (info.isSymlink) {
      const link = await Deno.readLink(TARGET);
      if (link === SOURCE) {
        console.log("✓ pre-commit hook already installed");
        return;
      }
    }
    console.error(
      `error: ${TARGET} exists and is not our symlink. Back it up and re-run.`,
    );
    Deno.exit(2);
  }

  await Deno.symlink(SOURCE, TARGET);
  console.log(`✓ installed pre-commit hook (symlink ${TARGET} → ${SOURCE})`);
}

if (import.meta.main) await main();
