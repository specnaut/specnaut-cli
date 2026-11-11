import {
  crossedReleases,
  type ReleaseHistory,
  type ReleaseNotes,
} from "../domain/release_notes.ts";
import type { AppliedResult, UpToDateResult } from "./upgrade_run.ts";

/** What the binary carries about releases: its own templates version and the history beside it. */
export type BinaryReleases = {
  readonly templatesVersion: string;
  readonly history: ReleaseHistory;
};

/**
 * The release notes an upgrade crossed (cli#759, FR-001). The one place the
 * range is decided, the same way for an applied run and an up-to-date one:
 *
 * - from: `fromVersion`, the version the lock recorded BEFORE this run. Not the
 *   upgrade marker's `from`, which keeps the start of the oldest unreconciled
 *   upgrade and would repeat notes a previous run already showed.
 * - to: the binary's templates version, which every upgrade moves the lock to.
 *
 * Never keyed on the result's status: a crossing whose files were all current
 * (only the version moved) ends up-to-date, and crossed releases all the same.
 */
export function upgradeReleaseNotes(
  result: Pick<AppliedResult | UpToDateResult, "fromVersion">,
  binary: BinaryReleases,
): ReleaseNotes {
  return crossedReleases(result.fromVersion, binary.templatesVersion, binary.history);
}
