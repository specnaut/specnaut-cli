import type { Backend, BackendProbe, SandboxPolicy } from "../domain/sandbox.ts";

/**
 * The ports a branch's gates are run through in a sandbox: what the host offers, where the run's
 * folders are, and one runner per backend. The domain decides the backend and the policy; these
 * only report the host and launch what the domain generated.
 */

/** The run cannot be sandboxed as asked; the message says why, and nothing ran. */
export class SandboxRefused extends Error {
  override name = "SandboxRefused";
}

export interface BackendProber {
  /** What the host offers now: engines, bubblewrap, `sandbox-exec`, the pinned image. */
  probe(): Promise<BackendProbe>;
}

/** The real paths a run is built over: no link on the way to any of them. */
export type HostFolders = {
  /** The export's scratch copy of the branch's tree. */
  readonly tree: string;
  readonly home: string;
  readonly checkout: string;
};

/** A new, empty folder of the user's alone; the sandbox's home and temp are made in it. */
export type ScratchFolder = {
  readonly path: string;
  /** Removes it and everything the run left in it. */
  remove(): Promise<void>;
};

export interface SandboxHost {
  /** The folders of a run on the export of `sha`; refuses an export that is not there. */
  locate(sha: string): Promise<HostFolders>;
  /**
   * `folders` as real paths, in order: a link is judged by where it leads, so one to the home or
   * into the checkout is refused like the folder itself. Refuses a folder that is not there.
   */
  real(folders: readonly string[]): Promise<string[]>;
  scratch(): Promise<ScratchFolder>;
}

/**
 * How a run ended: the command's exit code, or the wall clock ran out and it was stopped. A stop
 * that needed more than the launcher (a container's removal) and failed is named in `haltFailed`:
 * part of the run may still be going. A run that ended whose container could not be removed after
 * it names that in `removalFailed`. Each is the last removal's word, said once.
 */
export type RunOutcome =
  | { readonly kind: "exited"; readonly code: number; readonly removalFailed?: string }
  | { readonly kind: "timed_out"; readonly seconds: number; readonly haltFailed?: string };

/** A backend that runs something. */
export type RunnableBackend = Exclude<Backend, { kind: "static" }>;

export interface SandboxRunner {
  /** Runs `command` under `policy`, launching exactly what the domain generated for it. */
  run(policy: SandboxPolicy, command: readonly string[]): Promise<RunOutcome>;
}
