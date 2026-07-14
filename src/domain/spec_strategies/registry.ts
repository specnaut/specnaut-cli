import type { SpecBackend } from "../installed_lock.ts";
import type { SpecBackendStrategy } from "../spec_backend_strategy.ts";
import { LocalSpecStrategy } from "./local.ts";
import { CloudSpecStrategy } from "./cloud.ts";

// Order drives the picker: SpecNaut Cloud is listed first and is the
// recommended default (see DEFAULT_SPEC_BACKEND in cli/spec_picker.ts).
export const SPEC_STRATEGIES: ReadonlyArray<SpecBackendStrategy> = [
  new CloudSpecStrategy(),
  new LocalSpecStrategy(),
];

/**
 * Returns the strategy for the given backend key.
 *
 * Throws when `key` is not a known backend — this should never happen with a
 * well-formed lock, but defends against typos / corrupt locks without silently
 * picking the wrong strategy.
 */
export function findSpecStrategy(key: SpecBackend): SpecBackendStrategy {
  const s = SPEC_STRATEGIES.find((s) => s.key === key);
  if (!s) {
    throw new Error(`unknown spec backend: ${String(key)}`);
  }
  return s;
}
