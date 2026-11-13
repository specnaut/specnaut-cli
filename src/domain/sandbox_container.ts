/**
 * The container backend as a probe finds it: which engine runs it, and the caps that engine drops
 * on this host. `assessBackends` in `sandbox.ts` places it first; this file decides only its own.
 */

import type { BackendProbe, BackendStatus, Engine } from "./sandbox.ts";
import { engineDrops } from "./sandbox_limits.ts";

const NO_ROOTLESS = "no rootless podman";
const UNCAPPED = "rootless podman without cgroup v2 pids, memory and cpu delegated";
const REMOTE = "podman answers from a remote service, which reads its own containers.conf";

/**
 * Why rootless podman cannot run the sandbox's container, or `null` when it can. It needs the
 * pids, memory and cpu controllers delegated, since its runtime fails a run whose limit has no
 * controller. A remote podman is not offered: its service starts the container from its own
 * containers.conf, so the one the CLI hands a run's client, which keeps the user's variables,
 * volumes and mounts out of the container, would not apply.
 */
function podmanWhy(probe: BackendProbe): string | null {
  if (probe.podman !== "rootless") return NO_ROOTLESS;
  if (probe.podmanRemote) return REMOTE;
  const { memory, pids, cpuQuota } = probe.podmanLimits;
  return memory && pids && cpuQuota ? null : UNCAPPED;
}

/**
 * The engine a container runs on: rootless podman first, then docker. Docker's daemon discards a
 * limit its host cannot apply and runs, so docker is taken as it is.
 */
export function containerEngine(probe: BackendProbe): Engine | null {
  if (podmanWhy(probe) === null) return "podman";
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
    : `container: ${podmanWhy(probe)}, and no docker`;
  return { kind: "container", why, onThisOs: true };
}
