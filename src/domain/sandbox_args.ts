/**
 * The arguments that launch a command under a {@link SandboxPolicy}: for `podman run` /
 * `docker run`, and for `bwrap`. They translate the policy and add nothing to it: every folder
 * mounted is one it names, every variable set is one of its own with its value, and every
 * isolation flag is always present. Pure — the caller runs the launcher.
 */

import type { SandboxPolicy } from "./sandbox.ts";
import { isPinned } from "./sandbox_image.ts";
import { safePath } from "./sandbox_paths.ts";

/**
 * `run` arguments for podman or docker: no network, a read-only root, no capabilities, no
 * privilege gain, the `nobody` user, the policy's caps (swap counted in the memory cap), its
 * scratch folders as tmpfs and the exported tree as the one bind mount, read-only.
 * `--env NAME=value` always carries its value: `--env NAME` alone would copy the host's.
 */
export function containerArgs(
  policy: SandboxPolicy,
  image: string,
  command: readonly string[],
): string[] {
  if (!isPinned(image)) throw new Error(`container image ${image} is not pinned by digest`);
  const { limits } = policy;
  const tmpfs = `rw,nosuid,nodev,size=${limits.scratchBytes},mode=1777`;
  return [
    "run",
    "--rm",
    ...containerNetwork(policy.network),
    ...["--read-only", "--cap-drop", "ALL"],
    ...["--security-opt", "no-new-privileges", "--user", policy.user],
    ...["--pids-limit", String(limits.processes), "--memory", String(limits.memoryBytes)],
    ...["--memory-swap", String(limits.memoryBytes), "--cpus", String(limits.cpus)],
    ...policy.writes.flatMap((p) => ["--tmpfs", `${safePath(p)}:${tmpfs}`]),
    ...policy.reads.flatMap((
      p,
    ) => ["--mount", `type=bind,src=${p},dst=${safePath(p)},readonly=true`]),
    ...["--workdir", safePath(policy.workdir)],
    ...Object.entries(policy.env).flatMap(([k, v]) => ["--env", `${k}=${v}`]),
    image,
    ...command,
  ];
}

/** `--dev` brings a writable shared-memory folder of its own; a capped tmpfs replaces it. */
const SHM = "/dev/shm";

/**
 * `bwrap` arguments: every namespace unshared (network included, so loopback is the sandbox's
 * own), killed with its parent, a new session (no terminal to inject keystrokes into), an empty
 * environment refilled from the policy, no capabilities. System folders are bound read-only when
 * the host has them, the toolchain and the tree always; the scratch folders and shared memory are
 * size-capped tmpfs. The sandbox's own root is remounted read-only last, so nothing outside those
 * folders can be created in it. `--` ends the options: a command starting with `-` is never one.
 */
export function bwrapArgs(policy: SandboxPolicy, command: readonly string[]): string[] {
  const size = String(policy.limits.scratchBytes);
  return [
    ...["--unshare-all", "--die-with-parent", "--new-session", "--clearenv", "--cap-drop", "ALL"],
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
