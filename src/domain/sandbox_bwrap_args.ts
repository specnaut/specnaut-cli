/**
 * The arguments that launch a command under a {@link SandboxPolicy} with bubblewrap, and the
 * systemd user scope around it. They translate the policy and add nothing to it, as the container
 * arguments do (`sandbox_args.ts`). Pure — the caller runs the launcher.
 */

import type { SandboxPolicy } from "./sandbox.ts";
import { safePath } from "./sandbox_paths.ts";
import { SECCOMP_FD } from "./sandbox_seccomp.ts";

/** `--dev` brings a writable shared-memory folder of its own; a capped tmpfs replaces it. */
const SHM = "/dev/shm";

/**
 * `bwrap` arguments: every namespace unshared (network included, so loopback is the sandbox's
 * own; the user namespace always, so that `--disable-userns` can forbid the process from making a
 * nested one, where it would hold every capability again), killed with its parent, a new
 * session (no terminal to inject keystrokes into), an empty environment refilled from the
 * policy, no capabilities, and the syscall filter (`sandbox_seccomp.ts`) read from
 * {@link SECCOMP_FD}, which the launcher opens. System folders are bound read-only when
 * the host has them, the toolchain and the tree always, each hidden file then covered by an empty
 * one (`/dev/null`) so it reads as nothing; the scratch folders and shared memory are
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
    ...policy.hiddenFiles.flatMap((f) => ["--ro-bind", "/dev/null", safePath(f)]),
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
 * A process the memory cap ends is ended alone, as in a container: systemd would otherwise stop
 * the whole scope, and the run would report nothing of what the cap did.
 */
export function scopeArgs(policy: SandboxPolicy): string[] {
  const { memoryBytes, processes, cpus } = policy.limits;
  return [
    ...["systemd-run", "--user", "--scope", "--quiet", "--collect"],
    ...["-p", `MemoryMax=${memoryBytes}`, "-p", "MemorySwapMax=0"],
    ...["-p", `TasksMax=${processes}`, "-p", `CPUQuota=${cpus * 100}%`],
    ...["-p", "OOMPolicy=continue"],
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
