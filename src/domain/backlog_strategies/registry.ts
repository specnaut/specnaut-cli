import type { BacklogBackend } from "../installed_lock.ts";
import type { BacklogBackendStrategy } from "../backlog_backend_strategy.ts";
import { LocalBacklogStrategy } from "./local.ts";
import { GithubBacklogStrategy } from "./github.ts";
import { GitlabBacklogStrategy } from "./gitlab.ts";
import { CloudBacklogStrategy } from "./cloud.ts";

export const BACKLOG_STRATEGIES: ReadonlyArray<BacklogBackendStrategy> = [
  new LocalBacklogStrategy(),
  new GithubBacklogStrategy(),
  new GitlabBacklogStrategy(),
  new CloudBacklogStrategy(),
];

/**
 * Returns the strategy for the given backend key.
 *
 * Throws when `key` is not a known backend — this should never happen
 * with a well-formed lock, but defends against typos / corrupt locks
 * without silently picking the wrong strategy.
 */
export function findBacklogStrategy(
  key: BacklogBackend,
): BacklogBackendStrategy {
  const s = BACKLOG_STRATEGIES.find((s) => s.key === key);
  if (!s) {
    throw new Error(`unknown backlog backend: ${String(key)}`);
  }
  return s;
}
