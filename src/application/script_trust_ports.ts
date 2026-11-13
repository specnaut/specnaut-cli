import type { ScopeRoot } from "../domain/checkout_scope.ts";
import type { CheckoutWalk } from "../domain/checkout_trust.ts";
import type { BaseEntry, TreeWalk } from "../domain/script_trust.ts";

/**
 * The ports the script and checkout checks read through. Their own module: `ports.ts` is the
 * project-file ports, and these read a repository's commits and folders of its work tree.
 */

/**
 * The most bytes one script, or the lock, is read as, from a commit or from the disk: far above any
 * helper script, so only a file that is not one meets it, and no check holds an unbounded file.
 */
export const MAX_SCRIPT_BYTES = 1024 * 1024;

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
  /**
   * Whether git checks a link out as a link here: `core.symlinks` as the repository's and the
   * user's global configuration set it, true unless set false. The system configuration is not
   * read (the hardened git turns it off), so a `false` set only there reads as true: a file git
   * wrote for a link then fails the check, never passes it.
   */
  symlinks(): Promise<boolean>;
  /** The full sha `ref` names as a commit, or `null`. */
  commitOf(ref: string): Promise<string | null>;
  mergeBase(a: string, b: string): Promise<string | null>;
  /** How many commits `to` has that `from` lacks. */
  aheadCount(from: string, to: string): Promise<number>;
  /** The commits `to` has that `from` lacks, as full shas. */
  commitsAhead(from: string, to: string): Promise<string[]>;
  /** Every entry under `dir` at `commit`, recursively; a blob over the cap is a throw. */
  listTree(commit: string, dir: string): Promise<BaseEntry[]>;
  /** The entries of `root` at `commit`, a link with its target; a blob over the cap is a throw. */
  listRoot(commit: string, root: ScopeRoot): Promise<BaseEntry[]>;
  /** One path at `commit`; a blob over the cap is a throw. */
  readFile(commit: string, path: string): Promise<BaseFile>;
  /** The paths changed between two commits, from the repository's top. */
  changedNames(from: string, to: string): Promise<string[]>;
}

/** HEAD's reflog, read only: never a ref moved, never an entry expired. */
export interface HeadReflogReader {
  /**
   * The reflog's bytes, oldest entry first, or `null` when git keeps none for HEAD; a throw when
   * there is one it cannot read, as in a repository whose refs are in a reftable.
   */
  headReflog(): Promise<Uint8Array | null>;
}

/** Walks the scripts folder of the work tree, following no link. */
export interface ScriptTreeWalker {
  walk(): Promise<TreeWalk>;
}

/** Walks one root of the checked files in the work tree, following no link but resolving each. */
export interface CheckoutTreeWalker {
  walk(root: ScopeRoot): Promise<CheckoutWalk>;
}

/**
 * What the session's start record reads as: its text, or why the check cannot read it (no record,
 * one named outside the record folder, a file that cannot be read). Each refusal is final: the
 * check never falls back to the checkout as it is now.
 */
export type RecordRead =
  | { readonly kind: "read"; readonly text: string }
  | { readonly kind: "refused"; readonly reason: string };

/** The record of the checkout the running session started on. */
export interface SessionRecordReader {
  read(): Promise<RecordRead>;
}

/**
 * Where the session's record is: taken now, or the one it already had, which is never replaced.
 * `pruneFailure` says why other sessions' old records could not all be removed: the record stands.
 */
export type RecordWrite = {
  readonly kind: "taken" | "existing";
  readonly path: string;
  readonly pruneFailure?: string;
};

/** Stores the first record of the session `sessionId`, and finds it again. */
export interface SessionRecordWriter {
  write(sessionId: string, text: string): Promise<RecordWrite>;
  /** The session's record as an `existing` one, renewed, or `null` when it has none. */
  find(sessionId: string): Promise<RecordWrite | null>;
}
