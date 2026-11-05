import type { SizeConfig } from "../domain/size_limits.ts";
import type { SkipReason } from "../domain/structural_scan_types.ts";

/**
 * What the structural scan needs from a repository, and nothing more (plan A3): the narrow port
 * an adapter for an unvetted repository implements. The adapter reads the bytes itself; this side
 * never sees a file handle, a git process or an absolute path.
 */

/** Where the lock the scan reads its managed paths from lives, relative to the root. */
export const LOCK_PATH = ".specnaut/installed.lock";

/** A tracked path as the index lists it. The mode is the index's word; the disk is asked apart. */
export type TrackedEntry = {
  readonly path: string;
  readonly mode: "file" | "symlink" | "submodule";
};

/** Every tracked path once, and how many names could not be decoded as UTF-8. */
export type TrackedListing = {
  readonly entries: readonly TrackedEntry[];
  readonly undecodable: number;
};

/** `sniff`: binariness is the bytes' to tell. `decode`: the text is wanted, within the read cap. */
export type ReadRequest = { readonly sniff: boolean; readonly decode: boolean };

/** What reading one tracked path found. `text` is null when not asked for, or over the cap. */
export type FileRead =
  | { readonly kind: "missing" }
  | { readonly kind: "skipped"; readonly reason: SkipReason }
  | { readonly kind: "binary" }
  | { readonly kind: "text"; readonly lines: number; readonly text: string | null };

/** The paths `.specnaut/installed.lock` lists, or why it cannot be read. */
export type LockEntries =
  | { readonly kind: "ok"; readonly paths: ReadonlySet<string> }
  | { readonly kind: "unreadable"; readonly reason: string };

export interface ScanRepository {
  /** `.specnaut/size-limits.yml`, read as the ratchet reads it. */
  sizeConfig(): Promise<SizeConfig>;
  lockEntries(): Promise<LockEntries>;
  /** Every tracked path, or those under `path`, a literal repository-relative pathspec. */
  listTracked(path: string | null): Promise<TrackedListing>;
  /** Each path's `diff` attribute: `set`, `unset`, `unspecified` or a driver's name. */
  diffAttributes(paths: readonly string[]): Promise<ReadonlyMap<string, string>>;
  read(path: string, request: ReadRequest): Promise<FileRead>;
}
