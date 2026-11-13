/**
 * The arguments that launch a command under a {@link SandboxPolicy} in a container, for
 * `podman run` / `docker run`; bubblewrap's are `sandbox_bwrap_args.ts`'s. They translate the
 * policy and add nothing to it: every folder mounted is one it names, every variable set is one of
 * its own with its value (or a proxy one an engine would add, set empty), and every isolation
 * flag is always present. Pure — the caller runs the launcher.
 */

import type { Engine, SandboxPolicy } from "./sandbox.ts";
import type { ReportedCap, SandboxLimits } from "./sandbox_limits.ts";
import { isPinned } from "./sandbox_image.ts";
import { safePath } from "./sandbox_paths.ts";

/**
 * One container run: its pinned image, a name the caller makes unique, so that the launcher can
 * stop and remove exactly that container when the wall clock runs out, and the engine running it.
 */
export type ContainerRun = {
  readonly image: string;
  readonly name: string;
  readonly engine: Engine;
  /** The caps that engine drops on this host (the offered backend's): see `containerCaps`. */
  readonly dropped: readonly ReportedCap[];
  /** The CPUs on that engine's host (the offered backend's), or `null`: see `containerCaps`. */
  readonly cpus: number | null;
};

/** A name the engines accept that can never be read as a flag. */
const CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;

/**
 * `run` arguments for podman or docker: a named run of an image already present (never pulled, so
 * offline), its entrypoint emptied so the command given is what runs, an init that reaps orphans
 * and forwards signals, no engine log, no network, a read-only root, no capabilities, no privilege
 * gain, the `nobody` user, the policy's caps (paged-out memory counted in the memory cap), its
 * scratch as tmpfs, the exported tree as the one read-only bind mount, the policy's variables only.
 */
export function containerArgs(
  policy: SandboxPolicy,
  run: ContainerRun,
  command: readonly string[],
): string[] {
  const { image, name } = checkedRun(run);
  return [
    ...["run", "--rm", "--pull", "never", "--name", name, "--init", "--log-driver", "none"],
    ...containerNetwork(policy.network),
    ...["--entrypoint", "", "--read-only", "--cap-drop", "ALL"],
    ...["--security-opt", "no-new-privileges", "--user", policy.user],
    ...containerCaps(policy.limits, run),
    ...containerFolders(policy),
    ...containerEnv(policy, run.engine),
    image,
    ...command,
  ];
}

/**
 * The proxy variables an engine adds to a container on its own: podman copies the host's unless
 * told `--http-proxy=false`, and docker's client copies those of its configuration file unless the
 * run sets them.
 */
const PROXIES = ["HTTP_PROXY", "HTTPS_PROXY", "FTP_PROXY", "NO_PROXY", "ALL_PROXY"]
  .flatMap((name) => [name, name.toLowerCase()]);

/**
 * The container's variables: the proxy ones set empty first, so that it gets only the policy's
 * (the run has no network for a proxy to serve), then the policy's. `--env NAME=value` always
 * carries its value: `--env NAME` alone would copy the host's.
 */
function containerEnv(policy: SandboxPolicy, engine: Engine): string[] {
  const set = [
    ...PROXIES.map((name) => `${name}=`),
    ...Object.entries(policy.env).map(([k, v]) => `${k}=${v}`),
  ];
  return [
    ...(engine === "podman" ? ["--http-proxy=false"] : []),
    ...set.flatMap((e) => ["--env", e]),
  ];
}

/** `run`, once its image is pinned by digest and its name is plain; otherwise a thrown error. */
function checkedRun(run: ContainerRun): ContainerRun {
  if (!isPinned(run.image)) throw new Error(`container image ${run.image} is not pinned by digest`);
  if (!CONTAINER_NAME.test(run.name)) {
    throw new Error(`container name ${JSON.stringify(run.name)} is not plain`);
  }
  return run;
}

/**
 * The process, memory and CPU caps, the memory cap bounding what is paged out as well. `--cpus` is
 * left out where the engine lacks the CPU quota: docker refuses it outright there ("NanoCPUs can
 * not be set"), so every run would fail, where any other limit its host lacks is only discarded.
 * It is lowered to the CPUs on the engine's host where it has fewer (one, on a small CI machine):
 * docker refuses a quota above them ("range of CPUs is from 0.01 to 1.00"), and the run can use
 * no more than they are anyway, so the cap still holds.
 */
function containerCaps(limits: SandboxLimits, run: Pick<ContainerRun, "dropped" | "cpus">) {
  const most = run.cpus === null ? limits.cpus : Math.min(limits.cpus, run.cpus);
  const cpus = run.dropped.includes("cpus") ? [] : ["--cpus", String(most)];
  return [
    ...["--pids-limit", String(limits.processes), "--memory", String(limits.memoryBytes)],
    ...["--memory-swap", String(limits.memoryBytes), ...cpus],
  ];
}

/** Scratch folders as capped tmpfs, the tree as a read-only bind mount, the tree as workdir. */
function containerFolders(policy: SandboxPolicy): string[] {
  const tmpfs = `rw,nosuid,nodev,size=${policy.limits.scratchBytes},mode=1777`;
  return [
    ...policy.writes.flatMap((p) => ["--tmpfs", `${safePath(p)}:${tmpfs}`]),
    ...policy.reads.flatMap((p) => ["--mount", bindMount(p)]),
    ...["--workdir", safePath(policy.workdir)],
  ];
}

/** A read-only bind mount of `path` at the same path inside. */
function bindMount(path: string): string {
  const p = safePath(path);
  return `type=bind,src=${p},dst=${p},readonly=true`;
}

/** The container's network: with `none` it has its own loopback only, never the host's. */
function containerNetwork(network: SandboxPolicy["network"]): string[] {
  switch (network) {
    case "none":
      return ["--network", "none"];
  }
}
