/**
 * The container backend as a probe finds it: which engine runs it, and the caps that engine drops
 * on this host. `assessBackends` in `sandbox.ts` places it first; this file decides only its own.
 */

import type { BackendProbe, BackendStatus } from "./sandbox.ts";
import { dockerDrops } from "./sandbox_limits.ts";

const UNCAPPED_PODMAN =
  "container: rootless podman without cgroup v2 pids, memory and cpu delegated, and no docker";

/** The container backend `probe` offers, or why there is none. */
export function containerStatus(probe: BackendProbe): BackendStatus {
  const podman = probe.podman === "rootless" && probe.podmanCgroups;
  const engine = podman ? "podman" : probe.docker ? "docker" : null;
  if (probe.image.kind === "pinned" && engine) {
    const dropped = engine === "docker" ? dockerDrops(probe.dockerLimits) : [];
    return {
      kind: "container",
      offered: { kind: "container", engine, image: probe.image.ref, dropped },
    };
  }
  const why = probe.image.kind === "none"
    ? `no container image: ${probe.image.why}`
    : probe.podman === "rootless"
    ? UNCAPPED_PODMAN
    : "container: no rootless podman and no docker";
  return { kind: "container", why, onThisOs: true };
}
