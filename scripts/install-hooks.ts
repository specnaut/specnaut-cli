// Installs hooks/pre-commit into .git/hooks/pre-commit as a symlink.
// Run via `deno task setup`. Idempotent.

import { resolve } from "@std/path";

const ROOT = new URL("..", import.meta.url).pathname;
const SOURCE = resolve(ROOT, "hooks/pre-commit");
const TARGET = resolve(ROOT, ".git/hooks/pre-commit");

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}

async function main() {
  if (!(await exists(`${ROOT}/.git`))) {
    console.error("error: not a git repository");
    Deno.exit(1);
  }

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
