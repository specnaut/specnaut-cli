/**
 * The container backend as a probe finds it: which engine runs it, and the caps that engine drops
 * on this host. `assessBackends` in `sandbox.ts` places it first; this file decides only its own.
 */

import type { BackendProbe, BackendStatus, Engine } from "./sandbox.ts";
import { engineDrops } from "./sandbox_limits.ts";

const NO_ROOTLESS = "no rootless podman";
const UNCAPPED = "rootless podman without cgroup v2 pids, memory and cpu delegated";
const REMOTE = "podman answers from a remote service, which reads its own containers.conf";
const UNREAD = "podman's version could not be read";
const DOCKER_ON_PODMAN =
  "docker answers from a podman service, which reads its own containers.conf";
const DOCKER_UNREAD = "docker's components could not be read, so it may be a podman service";
const OLD = "podman older than 4.8, whose containers.conf cannot empty a list";

/**
 * The oldest podman that can run the sandbox's container: 4.8, the first to read `{append=false}`
 * in a containers.conf list. That syntax arrived in containers/common v0.57.0 (containers.conf(5),
 * "APPENDING TO STRING ARRAYS"), which Podman 4.8.0 is the first to build on (4.7.2 has v0.56.0).
 * The CLI's own containers.conf empties each list with it, so that a list an earlier file marked
 * `{append=true}` cannot carry the user's entries into the container.
 */
const MINIMUM = { major: 4, minor: 8 };

/** Whether podman `version` is at or above {@link MINIMUM}; `null` when it cannot be read. */
function recentEnough(version: string | null): boolean | null {
  const found = version?.match(/^v?(\d+)\.(\d+)(?:\.\d+)?(?:[-+~].*)?$/);
  if (!found) return null;
  const [major, minor] = [Number(found[1]), Number(found[2])];
  return major > MINIMUM.major || (major === MINIMUM.major && minor >= MINIMUM.minor);
}

/**
 * Why rootless podman cannot run the sandbox's container, or `null` when it can. It needs the
 * pids, memory and cpu controllers delegated, since its runtime fails a run whose limit has no
 * controller. A remote podman is not offered: its service starts the container from its own
 * containers.conf, so the one the CLI hands a run's client, which keeps the user's variables,
 * volumes and mounts out of the container, would not apply. Nor is one older than
 * {@link MINIMUM}, or one whose version cannot be read, which may not read that file as written.
 */
function podmanWhy(probe: BackendProbe): string | null {
  if (probe.podman !== "rootless") return NO_ROOTLESS;
  if (probe.podmanRemote) return REMOTE;
  const recent = recentEnough(probe.podmanVersion);
  if (recent !== true) return recent === null ? UNREAD : OLD;
  const { memory, pids, cpuQuota } = probe.podmanLimits;
  return memory && pids && cpuQuota ? null : UNCAPPED;
}

/**
 * Why docker cannot run the sandbox's container, or `null` when it can. Its daemon discards a
 * limit its host cannot apply and runs, so docker is taken as it is, unless that daemon is a
 * podman service: it starts the container from its own containers.conf, as a remote podman does.
 * One whose components could not be read is not offered either: it may be such a service.
 */
function dockerWhy(probe: BackendProbe): string | null {
  if (!probe.docker) return "no docker";
  if (probe.dockerOnPodman === null) return DOCKER_UNREAD;
  return probe.dockerOnPodman ? DOCKER_ON_PODMAN : null;
}

/** The engine a container runs on: rootless podman first, then docker. */
export function containerEngine(probe: BackendProbe): Engine | null {
  if (podmanWhy(probe) === null) return "podman";
  return dockerWhy(probe) === null ? "docker" : null;
}

/** The container backend `probe` offers, or why there is none. */
export function containerStatus(probe: BackendProbe): BackendStatus {
  const engine = containerEngine(probe);
  if (probe.image.kind === "pinned" && engine) {
    const onPodman = engine === "podman";
    const dropped = engineDrops(onPodman ? probe.podmanLimits : probe.dockerLimits);
    const cpus = onPodman ? probe.podmanCpus : probe.dockerCpus;
    return {
      kind: "container",
      offered: { kind: "container", engine, image: probe.image.ref, dropped, cpus },
    };
  }
  const why = probe.image.kind === "none"
    ? `no container image: ${probe.image.why}`
    : `container: ${podmanWhy(probe)}, and ${dockerWhy(probe)}`;
  return { kind: "container", why, onThisOs: true };
}
