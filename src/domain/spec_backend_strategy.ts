import type { SpecBackend } from "./installed_lock.ts";

/**
 * Strategy for a spec-storage backend (spec 020). Each backend exposes its
 * display label and post-init copy without call sites switching on the backend
 * string. A thinner sibling of {@link BacklogBackendStrategy}: the cloud spec
 * backend reuses the Cloud-link file (`backlog-config.yml`) that
 * `specnaut cloud login` writes, so no per-backend config stub is needed here.
 *
 * To add a new backend:
 *   1. Add the string to `SpecBackend` in `installed_lock.ts`.
 *   2. Implement `SpecBackendStrategy` in `spec_strategies/<new>.ts`.
 *   3. Register it in `spec_strategies/registry.ts`.
 */
export interface SpecBackendStrategy {
  readonly key: SpecBackend;

  /** Human-readable label shown in the interactive picker. */
  readonly displayName: string;

  /**
   * Lines to print via `console.log(dim(...))` after a successful init.
   * Empty array = silent. Always emitted in order.
   */
  initMessages(): readonly string[];
}
