/**
 * The arguments that launch a command under a {@link SandboxPolicy}: for `podman run` /
 * `docker run`, and for `bwrap`. They translate the policy and add nothing to it: every folder
 * mounted is one it names, every variable set is one of its own with its value (or a proxy one an
 * engine would add, set empty), and every isolation flag is always present. Pure — the caller runs the launcher.
 */

import type { Engine, SandboxPolicy } from "./sandbox.ts";
import type { SandboxLimits } from "./sandbox_limits.ts";
import { isPinned } from "./sandbox_image.ts";
import { safePath } from "./sandbox_paths.ts";
import { SECCOMP_FD } from "./sandbox_seccomp.ts";

/**
 * One container run: its pinned image, a name the caller makes unique, so that the launcher can
 * stop and remove exactly that container when the wall clock runs out, and the engine running it.
 */
export type ContainerRun = {
  readonly image: string;
  readonly name: string;
  readonly engine: Engine;
};

/** A name the engines accept that can never be read as a flag. */
const CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;

/**
 * `run` arguments for podman or docker: a named run of an image already present (never pulled,
 * so a run stays offline), with an init process that reaps orphans and forwards signals, no log
 * the engine keeps after it, no network, a read-only root, no capabilities, no privilege gain, the
 * `nobody` user, the policy's caps (swap counted in the memory cap), its scratch folders as tmpfs
 * and the exported tree as the one bind mount, read-only, and the policy's variables only.
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
    ...["--read-only", "--cap-drop", "ALL"],
    ...["--security-opt", "no-new-privileges", "--user", policy.user],
    ...containerCaps(policy.limits),
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

/** The process, memory and CPU caps; swap is set to the memory cap, so none is added. */
function containerCaps(limits: SandboxLimits): string[] {
  return [
    ...["--pids-limit", String(limits.processes), "--memory", String(limits.memoryBytes)],
    ...["--memory-swap", String(limits.memoryBytes), "--cpus", String(limits.cpus)],
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

/** `--dev` brings a writable shared-memory folder of its own; a capped tmpfs replaces it. */
const SHM = "/dev/shm";

/**
 * `bwrap` arguments: every namespace unshared (network included, so loopback is the sandbox's
 * own; the user namespace always, so that `--disable-userns` can forbid the process from making a
 * nested one, where it would hold every capability again), killed with its parent, a new
 * session (no terminal to inject keystrokes into), an empty environment refilled from the
 * policy, no capabilities, and the syscall filter (`sandbox_seccomp.ts`) read from
 * {@link SECCOMP_FD}, which the launcher opens. System folders are bound read-only when
 * the host has them, the toolchain and the tree always; the scratch folders and shared memory are
 * size-capped tmpfs. The sandbox's own root is remounted read-only last, so nothing outside those
 * folders can be created in it. `--` ends the options: a command starting with `-` is never one.
 */
export function bwrapArgs(policy: SandboxPolicy, command: readonly string[]): string[] {
  const size = String(policy.limits.scratchBytes);
  return [
    ...["--unshare-all", "--unshare-user", "--disable-userns"],
    ...["--die-with-parent", "--new-session", "--clearenv", "--cap-drop", "ALL"],
    ...["--seccomp", String(SECCOMP_FD)],
    ...bwrapNetwork(policy.network),
    ...policy.system.flatMap((p) => ["--ro-bind-try", safePath(p), p]),
    ...policy.reads.flatMap((p) => ["--ro-bind", safePath(p), p]),
    ...["--proc", "/proc", "--dev", "/dev"],
    ...[SHM, ...policy.writes].flatMap((p) => ["--size", size, "--tmpfs", safePath(p)]),
    ...["--chdir", safePath(policy.workdir)],
    ...Object.entries(policy.env).flatMap(([k, v]) => ["--setenv", k, v]),
    ...["--remount-ro", "/"],
    "--",
    ...command,
  ];
}

/**
 * The prefix that runs bubblewrap in a transient systemd user scope carrying the policy's memory
 * (no swap on top), process and CPU caps: a cgroup holds the whole run, which per-process limits
 * could not. `--scope` runs the command in place, so its input and output pass straight through.
 */
export function scopeArgs(policy: SandboxPolicy): string[] {
  const { memoryBytes, processes, cpus } = policy.limits;
  return [
    ...["systemd-run", "--user", "--scope", "--quiet", "--collect"],
    ...["-p", `MemoryMax=${memoryBytes}`, "-p", "MemorySwapMax=0"],
    ...["-p", `TasksMax=${processes}`, "-p", `CPUQuota=${cpus * 100}%`],
  ];
}

/**
 * What `systemd-run --user` needs of the caller's environment to reach the user manager: its
 * runtime folder and session bus. Without them the scope is refused on a real host. Nothing else
 * of the caller's is passed, and bubblewrap's `--clearenv` keeps even these from the sandbox.
 */
const USER_BUS = ["XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"];

/** The user-bus variables `env` sets, by name; one it does not set is left out. */
export function userBus(env: (name: string) => string | undefined): Record<string, string> {
  return Object.fromEntries(USER_BUS.flatMap((name) => {
    const value = env(name);
    return value === undefined ? [] : [[name, value]];
  }));
}

/** The container's network: with `none` it has its own loopback only, never the host's. */
function containerNetwork(network: SandboxPolicy["network"]): string[] {
  switch (network) {
    case "none":
      return ["--network", "none"];
  }
}

/**
 * Bubblewrap's network: `--unshare-all` already gave the sandbox a network namespace of its own,
 * so `none` adds nothing; any other value would be the `--share-net` it must never carry.
 */
function bwrapNetwork(network: SandboxPolicy["network"]): string[] {
  switch (network) {
    case "none":
      return [];
  }
}
