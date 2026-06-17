// Legacy config-dir migration for the specflow→specnaut rebrand.
//
// Pre-rebrand projects keep their managed tree under `.specflow/`; the rebrand
// moves it to `.specnaut/`. `init` and `upgrade` call this once, up front, so an
// existing project transparently lands on the new layout. Idempotent, and it
// REFUSES to act when both dirs exist — it never merges or overwrites.

import { join } from "@std/path";

export type LegacyMigrationResult =
  | { kind: "migrated" }
  | { kind: "already-current" }
  | { kind: "conflict" }
  | { kind: "nothing-to-migrate" };

async function isDir(p: string): Promise<boolean> {
  try {
    return (await Deno.stat(p)).isDirectory;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}

/**
 * Rename a legacy `.specflow/` project dir to `.specnaut/`:
 *  - `migrated`           — renamed legacy → current
 *  - `already-current`    — only `.specnaut/` exists (no-op)
 *  - `conflict`           — BOTH exist; caller must resolve (never overwrite)
 *  - `nothing-to-migrate` — neither exists (fresh project)
 */
export async function migrateLegacyConfigDir(
  projectDir: string,
): Promise<LegacyMigrationResult> {
  const legacy = join(projectDir, ".specflow");
  const current = join(projectDir, ".specnaut");
  const hasCurrent = await isDir(current);
  const hasLegacy = await isDir(legacy);
  if (hasCurrent && hasLegacy) return { kind: "conflict" };
  if (hasCurrent) return { kind: "already-current" };
  if (!hasLegacy) return { kind: "nothing-to-migrate" };
  await Deno.rename(legacy, current);
  return { kind: "migrated" };
}
