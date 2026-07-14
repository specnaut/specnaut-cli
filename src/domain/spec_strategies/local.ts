import type { SpecBackendStrategy } from "../spec_backend_strategy.ts";

/**
 * The pre-feature behaviour: specs are markdown files under `.specnaut/specs/`.
 * A first-class, fully-supported default — zero-config and silent at init
 * (FR-003 local parity).
 */
export class LocalSpecStrategy implements SpecBackendStrategy {
  readonly key = "local" as const;
  readonly displayName = "Local Markdown files (.specnaut/specs/)";

  initMessages(): readonly string[] {
    return [];
  }
}
