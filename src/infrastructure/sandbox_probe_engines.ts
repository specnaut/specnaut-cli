import type { SubprocessRunner } from "../application/ports.ts";
import type { BackendProbe } from "../domain/sandbox.ts";
import type { EngineLimits } from "../domain/sandbox_hosts.ts";

/**
 * Podman's and docker's own reports of what they offer a sandbox: facts the domain judges
 * (`containerStatus`), asked in the environment a run starts them with.
 */

/** The runner the engines are asked through, and the environment they are asked in. */
export type Engines = { readonly runner: SubprocessRunner; readonly env: Record<string, string> };

type Podman = Pick<
  BackendProbe,
  "podman" | "podmanRemote" | "podmanVersion" | "podmanLimits" | "podmanCpus"
>;
type Docker = Pick<BackendProbe, "docker" | "dockerOnPodman" | "dockerLimits" | "dockerCpus">;
const NO_LIMITS: EngineLimits = { memory: false, swap: false, pids: false, cpuQuota: false };
export const NO_PODMAN: Podman = {
  podman: "absent",
  podmanRemote: false,
  podmanVersion: null,
  podmanLimits: NO_LIMITS,
  podmanCpus: null,
};
export const NO_DOCKER: Docker = {
  docker: false,
  dockerOnPodman: false,
  dockerLimits: NO_LIMITS,
  dockerCpus: null,
};

/**
 * Whether this process's own cgroup (cgroup v2) has the file podman checks before it passes on the
 * memory cap's bound on what is paged out: without it podman drops that bound, warning, and runs.
 * A remote podman's cgroup (a podman machine's VM) is not this process's: it is not tried, and its
 * bound counts as missing.
 */
const PAGING_TRIAL = [
  "-c",
  'read -r line < /proc/self/cgroup && test -e "/sys/fs/cgroup${line#0::}/memory.swap.max"',
];

/**
 * Podman's own report: whether it runs as the user, whether it answers from a service it does not
 * run itself, its version, and what it can limit on its host. Only a report saying it is local is
 * taken as local: one that does not say is counted remote.
 */
export async function probePodman({ runner, env }: Engines): Promise<Podman> {
  const args = ["info", "--format", "json"];
  const { code, stdout } = await runner.run("podman", args, { env });
  if (code !== 0) return NO_PODMAN;
  const info = parsed(stdout, "podman info");
  const host = info?.host;
  if (host === undefined) return NO_PODMAN;
  const podmanRemote = host?.serviceIsRemote !== false;
  const version: unknown = info?.version?.Version;
  return {
    podman: host?.security?.rootless === true ? "rootless" : "root",
    podmanRemote,
    podmanVersion: typeof version === "string" ? version : null,
    podmanLimits: await podmanLimits(runner, host, podmanRemote),
    podmanCpus: count(host?.cpus),
  };
}

/**
 * The limits podman can apply, as docker reports its own: one per cgroup v2 controller it holds,
 * and the memory cap's bound on what is paged out where the host has it ({@link PAGING_TRIAL}).
 */
async function podmanLimits(
  runner: SubprocessRunner,
  // deno-lint-ignore no-explicit-any
  host: any,
  remote: boolean,
): Promise<EngineLimits> {
  const controllers: unknown = host?.cgroupControllers;
  if (host?.cgroupVersion !== "v2" || !Array.isArray(controllers)) return NO_LIMITS;
  const memory = controllers.includes("memory");
  const tried = memory && !remote;
  const paging = tried && (await runner.run("/bin/sh", PAGING_TRIAL)).code === 0;
  const pids = controllers.includes("pids");
  return { memory, swap: paging, pids, cpuQuota: controllers.includes("cpu") };
}

/**
 * Docker's own report: whether its daemon answers with a version, and which limits it can apply
 * on its host. A limit it does not say it can (false, or left out) counts as one it cannot.
 */
export async function probeDocker(engines: Engines): Promise<Docker> {
  const args = ["info", "--format", "{{json .}}"];
  const { code, stdout } = await engines.runner.run("docker", args, { env: engines.env });
  if (code !== 0) return NO_DOCKER;
  const info = parsed(stdout, "docker info");
  if (typeof info?.ServerVersion !== "string" || info.ServerVersion === "") return NO_DOCKER;
  const can = (flag: string) => info[flag] === true;
  return {
    docker: true,
    dockerOnPodman: await dockerOnPodman(engines),
    dockerCpus: count(info.NCPU),
    dockerLimits: {
      memory: can("MemoryLimit"),
      swap: can("SwapLimit"),
      pids: can("PidsLimit"),
      cpuQuota: can("CpuCfsQuota"),
    },
  };
}

/**
 * Whether the daemon docker reaches is a podman service: its version names a `Podman Engine`
 * component, which a docker daemon's never does. Only a component list that can be read and names
 * none is docker's own; a version that fails, is not JSON, or has no such list is `null`, unknown.
 */
async function dockerOnPodman({ runner, env }: Engines): Promise<boolean | null> {
  const args = ["version", "--format", "{{json .}}"];
  const { code, stdout } = await runner.run("docker", args, { env });
  if (code !== 0) return null;
  const components: unknown = parsed(stdout, "docker version")?.Server?.Components;
  if (!Array.isArray(components)) return null;
  return components.some((c) => c?.Name === "Podman Engine");
}

/** `value` when it is a count (a whole number above zero), else `null`. */
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/** `stdout` as JSON, or `undefined` with a warning: a tool that answers garbled is not used. */
// deno-lint-ignore no-explicit-any
function parsed(stdout: string, what: string): any {
  try {
    return JSON.parse(stdout);
  } catch (err) {
    console.error(
      `warning: ${what} did not print JSON, so it is not used: ${(err as Error).message}`,
    );
    return undefined;
  }
}
