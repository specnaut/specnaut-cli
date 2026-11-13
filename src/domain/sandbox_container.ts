/**
 * The container backend as a probe finds it: which engine runs it, and the caps that engine drops
 * on this host. `assessBackends` in `sandbox.ts` places it first; this file decides only its own.
 */

import type { BackendProbe, BackendStatus, Engine } from "./sandbox.ts";
import { engineDrops } from "./sandbox_limits.ts";

const UNCAPPED_PODMAN =
  "container: rootless podman without cgroup v2 pids, memory and cpu delegated, and no docker";

/**
 * The engine a container runs on: rootless podman first, then docker. Podman needs the pids,
 * memory and cpu controllers delegated, since its runtime fails a run whose limit has no
 * controller; docker's daemon discards such a limit and runs, so docker is taken as it is.
 */
export function containerEngine(probe: BackendProbe): Engine | null {
  const { memory, pids, cpuQuota } = probe.podmanLimits;
  if (probe.podman === "rootless" && memory && pids && cpuQuota) return "podman";
  return probe.docker ? "docker" : null;
}

/** The container backend `probe` offers, or why there is none. */
export function containerStatus(probe: BackendProbe): BackendStatus {
  const engine = containerEngine(probe);
  if (probe.image.kind === "pinned" && engine) {
    const dropped = engineDrops(engine === "podman" ? probe.podmanLimits : probe.dockerLimits);
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
