import type { BaseEntry, TreeWalk } from "../domain/script_trust.ts";

/**
 * The ports `specnaut verify-scripts` reads through. Their own module: `ports.ts` is the
 * project-file ports, and these read a repository's commits and one folder of its work tree.
 */

/** One path of a commit, as the base lock is read. */
export type BaseFile =
  | { readonly kind: "absent" }
  | { readonly kind: "blob"; readonly bytes: Uint8Array }
  | { readonly kind: "not_regular" };

/**
 * Reads commits, never the work tree: no clean or smudge filter, no textconv, no program the
 * repository's configuration names. Paths in and out are relative to the project's folder.
 */
export interface GitObjectReader {
  /** The project's folder under git's top level: `""` at the top, else `sub/dir/`. */
  readonly projectPrefix: string;
  /** The full ref `refs/remotes/origin/HEAD` points at, or `null`. */
  originHead(): Promise<string | null>;
  /** The user's global `init.defaultBranch`, includes not followed, or `null`. */
  globalDefaultBranch(): Promise<string | null>;
  hasOrigin(): Promise<boolean>;
  /** The full sha `ref` names as a commit, or `null`. */
  commitOf(ref: string): Promise<string | null>;
  mergeBase(a: string, b: string): Promise<string | null>;
  /** How many commits `to` has that `from` lacks. */
  aheadCount(from: string, to: string): Promise<number>;
  /** Every entry under `dir` at `commit`, recursively. */
  listTree(commit: string, dir: string): Promise<BaseEntry[]>;
  readFile(commit: string, path: string): Promise<BaseFile>;
  /** The paths changed between two commits, from the repository's top. */
  changedNames(from: string, to: string): Promise<string[]>;
}

/** Walks the scripts folder of the work tree, following no link. */
export interface ScriptTreeWalker {
  walk(): Promise<TreeWalk>;
}
