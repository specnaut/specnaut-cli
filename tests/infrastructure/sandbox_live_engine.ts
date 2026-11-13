import type { BackendProbe, Engine } from "../../src/domain/sandbox.ts";
import { containerEngine } from "../../src/domain/sandbox_container.ts";

/**
 * The engine a live container test runs on, on a host `probe` describes: the one a run would be
 * offered (`containerEngine`, so the live tests and a run never disagree), else any podman, which
 * a test can still drive by hand.
 */
export function liveEngine(probe: BackendProbe): Engine | null {
  return containerEngine(probe) ?? (probe.podman !== "absent" ? "podman" : null);
}
