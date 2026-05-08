import type { BacklogBackend } from "./installed_lock.ts";

/**
 * Strategy interface for a backlog backend. Each backend implements
 * this interface to expose its specific behavior — config-stub
 * contents, init-time messages, display name — without call sites
 * needing to switch on the backend string.
 *
 * To add a new backend:
 *   1. Add the string to `BacklogBackend` in `installed_lock.ts`.
 *   2. Implement `BacklogBackendStrategy` in
 *      `backlog_strategies/<new>.ts`.
 *   3. Register it in `backlog_strategies/registry.ts`.
 */
export interface BacklogBackendStrategy {
  readonly key: BacklogBackend;

  /** Human-readable label shown in the interactive picker. */
  readonly displayName: string;

  /**
   * Returns the contents of `.specflow/backlog-config.yml` to write
   * at init time, or `null` if no config file is needed for this
   * backend (e.g. `local` is zero-config).
   */
  initConfigStub(): string | null;

  /**
   * Returns the lines to print to the user via `console.log(dim(...))`
   * after a successful init. Empty array = silent. Always emitted in
   * order.
   */
  initConfigMessages(): readonly string[];
}
