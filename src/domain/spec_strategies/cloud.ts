import type { SpecBackendStrategy } from "../spec_backend_strategy.ts";

/**
 * Specs hosted on SpecNaut Cloud via the versioned `/api/v1/specs*` contract.
 * The recommended default: parallelisable specs (no branch per spec), shareable,
 * no local file upkeep. Reuses the Cloud-link file + credentials that
 * `specnaut cloud login` provisions, so init only points the user at that step.
 */
export class CloudSpecStrategy implements SpecBackendStrategy {
  readonly key = "cloud" as const;
  readonly displayName = "SpecNaut Cloud (hosted specs — browser login)";

  initMessages(): readonly string[] {
    return [
      "↳ specs will be hosted on SpecNaut Cloud (spec_backend: cloud)",
      "  next: run `specnaut cloud login` to authenticate and link a Cloud project",
    ];
  }
}
