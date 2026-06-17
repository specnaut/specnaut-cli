import { sha256Hex } from "./sha256.ts";
import type { LockEntry } from "./installed_lock.ts";

export type ReconcileInputs = {
  readonly path: string;
  readonly onDiskContent: string;
  readonly stagingContent: string;
  readonly templatesVersion: string;
  readonly now: Date;
};

export type ReconcileOutput = {
  /**
   * Content to write to the project path, or `null` to leave it alone.
   * `acceptUpstream` returns `stagingContent`; `acceptCurrent` returns `null`.
   */
  readonly projectWrite: string | null;
  /**
   * Content of the on-disk file to back up to `<path>.specnaut.bak` before
   * overwriting, or `null` for no backup. Only `acceptUpstream` triggers a
   * backup (the file is being replaced).
   */
  readonly backupFromContent: string | null;
  /**
   * New lock entry value (caller writes it via `lockStore.write`).
   */
  readonly newLockEntry: LockEntry;
};

/** Take the upstream (bundled-template) content for this path. */
export async function computeAcceptUpstream(
  inputs: ReconcileInputs,
): Promise<ReconcileOutput> {
  const sha = await sha256Hex(inputs.stagingContent);
  return {
    projectWrite: inputs.stagingContent,
    backupFromContent: inputs.onDiskContent,
    newLockEntry: {
      sha256: sha,
      installedAt: inputs.now.toISOString(),
      templatesVersion: inputs.templatesVersion,
    },
  };
}

/** Keep the on-disk (user-customized) content; re-stamp the lock SHA. */
export async function computeAcceptCurrent(
  inputs: ReconcileInputs,
): Promise<ReconcileOutput> {
  const sha = await sha256Hex(inputs.onDiskContent);
  return {
    projectWrite: null,
    backupFromContent: null,
    newLockEntry: {
      sha256: sha,
      installedAt: inputs.now.toISOString(),
      templatesVersion: inputs.templatesVersion,
    },
  };
}
