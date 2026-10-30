import type { CloudConfig } from "../domain/cloud/cloud_config.ts";

/**
 * Ports onto `.specnaut/backlog-config.yml` (cli#694, cli#695).
 *
 * A file of their own rather than two more entries in `ports.ts`, which sits at
 * its size target: these two belong together — one file on disk, one adapter
 * (`FsBacklogConfigStore`) — and nothing else in `ports.ts` touches it.
 */

/**
 * The Cloud backend's coordinates in the project's backlog config. Mirrors
 * `LockStore`: an absent file reads as `null`, and any other read failure
 * throws — a config that exists but cannot be read is a fault, not an unlinked
 * project. A file that does not parse also reads as `null`.
 */
export interface CloudConfigStore {
  readCloudConfig(projectDir: string): Promise<CloudConfig | null>;
  /** Overwrites the file; refuses a path that resolves outside the project (cli#574). */
  writeCloudConfig(projectDir: string, apiUrl: string, projectKey: string): Promise<void>;
}

/** The stub `init` leaves for a remote backlog backend, for the user to finish. */
export interface BacklogConfigStore {
  /**
   * Writes `stub` unless a config already exists, and says whether it wrote.
   * Only `NotFound` means "absent": any other failure to look throws, rather
   * than being taken as leave to write. Refuses a path outside the project.
   */
  writeStubIfAbsent(projectDir: string, stub: string): Promise<boolean>;
}
