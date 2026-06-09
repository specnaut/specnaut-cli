import { dirname, isAbsolute, join, resolve } from "@std/path";
import type { ParentWorkspaceReader } from "../application/ports.ts";

/**
 * Filesystem-backed `ParentWorkspaceReader`.
 *
 * The only place that walks the filesystem and parses an ancestor `deno.json`
 * for parent-managed detection. Keeps the FS walk testable and the use cases
 * pure.
 */
export class FsParentWorkspaceReader implements ParentWorkspaceReader {
  /**
   * Walks ancestors of `targetDir` upward to the filesystem root and returns
   * the canonical path of the first *providing* Specflow workspace — an
   * ancestor with `.specflow/` AND a `deno.json` whose `workspace` array has a
   * member resolving (canonically) to `targetDir`.
   *
   * Member paths and the target are both canonicalised via `Deno.realPath` so
   * relative or symlinked spellings still match (FR-004). A missing or
   * unparseable `deno.json` is treated as a non-match and the walk continues.
   */
  async findProvidingAncestor(targetDir: string): Promise<string | null> {
    const canonicalTarget = await tryRealPath(targetDir);
    if (canonicalTarget === null) return null;

    // Walk dirname upward; stop when `dirname` no longer changes (root).
    let current = dirname(canonicalTarget);
    let parent = dirname(current);
    while (parent !== current) {
      if (await this.isProvidingWorkspace(current, canonicalTarget)) {
        // `current` is already canonical (derived from a canonical target via
        // repeated dirname), but normalise via realPath to be safe.
        return await tryRealPath(current) ?? current;
      }
      current = parent;
      parent = dirname(current);
    }
    // `current` is now the filesystem root — check it too before giving up.
    if (await this.isProvidingWorkspace(current, canonicalTarget)) {
      return await tryRealPath(current) ?? current;
    }
    return null;
  }

  /**
   * True iff `ancestor/.specflow/` exists AND `ancestor/deno.json` declares a
   * workspace member canonically equal to `canonicalTarget`.
   */
  private async isProvidingWorkspace(
    ancestor: string,
    canonicalTarget: string,
  ): Promise<boolean> {
    if (!(await isDir(join(ancestor, ".specflow")))) return false;

    const members = await readWorkspaceMembers(join(ancestor, "deno.json"));
    if (members === null) return false;

    for (const member of members) {
      const memberPath = isAbsolute(member) ? member : resolve(ancestor, member);
      const canonicalMember = await tryRealPath(memberPath);
      if (canonicalMember !== null && canonicalMember === canonicalTarget) {
        return true;
      }
    }
    return false;
  }

  async hasStandaloneOverride(targetDir: string): Promise<boolean> {
    return await fileExists(join(targetDir, ".specflow", "standalone.yml"));
  }
}

/** `Deno.realPath` that yields `null` for a missing path rather than throwing. */
async function tryRealPath(path: string): Promise<string | null> {
  try {
    return await Deno.realPath(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

/**
 * Reads the `workspace` member array from a `deno.json`. Returns `null` when
 * the file is missing, unparseable, or has no string `workspace` array —
 * every such case is a non-match the caller keeps walking past.
 */
async function readWorkspaceMembers(denoJsonPath: string): Promise<string[] | null> {
  let raw: string;
  try {
    raw = await Deno.readTextFile(denoJsonPath);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A malformed deno.json is tolerated: treat as non-match, keep walking.
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const workspace = (parsed as Record<string, unknown>).workspace;
  if (!Array.isArray(workspace)) return null;
  return workspace.filter((m): m is string => typeof m === "string");
}
