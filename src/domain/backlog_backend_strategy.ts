import type { BacklogBackend } from "./installed_lock.ts";
import type { ParsedKanbanURL } from "./backlog_strategies/kanban_url_parser.ts";

/**
 * Optional payload threaded into `initConfigStub` to pre-fill
 * backend-specific fields from the Kanban URL the user provided at
 * init time.
 */
export type StubContext = {
  readonly url?: ParsedKanbanURL;
  /**
   * GitHub `repo` field override — `<owner>/<name>`. When unset, the
   * GitHub strategy falls back to deriving the repo from `git remote
   * get-url origin` (caller is responsible for that probe). When still
   * unresolvable, the empty stub is rendered.
   */
  readonly repo?: string;
};

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
   *
   * The optional `ctx` carries data parsed from the Kanban URL the
   * user provided at init (and, for GitHub, the derived/overridden
   * `repo` value). When unset, the empty stub is rendered — the user
   * can fill it in by hand.
   */
  initConfigStub(ctx?: StubContext): string | null;

  /**
   * Returns the lines to print to the user via `console.log(dim(...))`
   * after a successful init. Empty array = silent. Always emitted in
   * order. The same `ctx` passed to `initConfigStub` is forwarded so
   * the message can reflect whether the populated or empty stub was
   * rendered (e.g. "ready to run /backlog" vs "fill in fields first").
   */
  initConfigMessages(ctx?: StubContext): readonly string[];
}
