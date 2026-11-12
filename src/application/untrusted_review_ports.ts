import type { BranchSource } from "../domain/branch_source.ts";
import type { ExportPlan, TreeEntry } from "../domain/tree_plan.ts";

/**
 * The ports a branch's tree is fetched and exported through. The export is read by object id
 * alone, never by a checkout, so nothing the branch carries runs or is discovered on the way.
 */

/** The request or what it fetched cannot be exported; the message says why. */
export class ExportRefused extends Error {
  override name = "ExportRefused";
}

export interface BranchFetcher {
  /** The remote names configured in the user's repository. */
  remotes(): Promise<string[]>;
  /**
   * Fetches `source` into a new bare repository at `gitDir`, which borrows the user's objects,
   * and returns the id the fetched ref names. The caller checks its shape.
   */
  fetch(source: BranchSource, gitDir: string): Promise<string>;
}

/** Raw objects of one repository, read without a work tree. */
export interface TreeObjects {
  /** The root tree of `commit`. */
  treeOf(commit: string): Promise<string>;
  /** Each object's size; refuses one that is missing or not of `type`. */
  sizes(ids: readonly string[], type: "tree" | "blob"): Promise<Map<string, number>>;
  readTrees(ids: readonly string[]): Promise<Map<string, TreeEntry[]>>;
  readBlobs(ids: readonly string[]): Promise<Map<string, Uint8Array>>;
}

/** Where one export lives: the borrowed repository and the two copies of the tree. */
export type ExportHome = {
  readonly root: string;
  readonly gitDir: string;
  /** Read by the reviewers; files `0644`, checked against the commit after writing. */
  readonly seats: string;
  /** Run by the sandbox, which mounts it read-only; executable bits kept; never re-hashed. */
  readonly scratch: string;
};

/**
 * One export's folders, outside the project. Everything it creates is removed by `remove`, and by
 * an exit trap until then: a failed or interrupted export leaves nothing behind.
 */
export interface ExportStore {
  /** A fresh path to fetch into; the folder above it exists, the path itself does not. */
  stage(): Promise<string>;
  /** The export's home for `sha`, the staged repository moved into it. */
  claim(sha: string, staged: string): Promise<ExportHome>;
  /** Writes both copies of the planned files, each created new, following no link. */
  write(plan: ExportPlan, objects: TreeObjects): Promise<void>;
  /** Re-hashes the reviewers' copy against the plan; refuses any difference. */
  verify(plan: ExportPlan): Promise<void>;
  remove(): Promise<void>;
  /**
   * Keeps every folder the export made past this process: the exit trap is disarmed, and a later
   * `remove` removes nothing. A review that runs over several commands keeps its export so.
   */
  keep(): void;
}
