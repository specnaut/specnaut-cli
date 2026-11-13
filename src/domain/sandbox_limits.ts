/**
 * The resource caps of a sandboxed run: data the policy carries, so a fork bomb, a memory bomb or
 * a hang ends at a known bound. `sandboxPolicy` in `sandbox.ts` decides that a policy carries them.
 */

import type { OfferedBackend, SandboxedBackend } from "./sandbox.ts";
import type { EngineLimits } from "./sandbox_hosts.ts";

export type SandboxLimits = {
  readonly processes: number;
  readonly memoryBytes: number;
  readonly cpus: number;
  readonly wallClockSeconds: number;
  /** Per scratch folder. */
  readonly scratchBytes: number;
};

const GIB = 1024 ** 3;

/** Enough for a test suite; a fork bomb, a memory bomb or a hang stops at them. */
export const LIMITS: SandboxLimits = {
  processes: 512,
  memoryBytes: 4 * GIB,
  cpus: 2,
  wallClockSeconds: 30 * 60,
  scratchBytes: GIB,
};

/**
 * Who applies a cap: the backend's own arguments, the launcher around it, a systemd user scope
 * around it when the host offers one (and nobody when it does not), or nobody. A cap a backend
 * cannot enforce is named as such here, never claimed: the run goes ahead without it.
 */
export type CapEnforcer = "arguments" | "launcher" | "scope" | "unenforced";

/** What a backend with no resource options gets: the launcher's wall clock, and nothing else. */
const WALL_CLOCK_ONLY: Readonly<Record<keyof SandboxLimits, CapEnforcer>> = {
  processes: "unenforced",
  memoryBytes: "unenforced",
  cpus: "unenforced",
  wallClockSeconds: "launcher",
  scratchBytes: "unenforced",
};

/**
 * Where each cap is applied, per backend. The wall clock is always the launcher's: no backend
 * option ends a run on time. A container's arguments carry its caps, but its engine drops one its
 * host cannot apply ({@link engineDrops}), and the run goes without it. Neither bubblewrap nor
 * `sandbox-exec` can cap processes, memory or CPU; bubblewrap caps its scratch tmpfs by size, and gets the other three from a systemd user
 * scope where cgroups are delegated (`scopeArgs`). Nothing does so around `sandbox-exec`.
 */
export const CAP_ENFORCEMENT: Readonly<
  Record<SandboxedBackend, Readonly<Record<keyof SandboxLimits, CapEnforcer>>>
> = {
  container: {
    processes: "arguments",
    memoryBytes: "arguments",
    cpus: "arguments",
    wallClockSeconds: "launcher",
    scratchBytes: "arguments",
  },
  bwrap: {
    processes: "scope",
    memoryBytes: "scope",
    cpus: "scope",
    wallClockSeconds: "launcher",
    scratchBytes: "arguments",
  },
  seatbelt: WALL_CLOCK_ONLY,
};

/**
 * A cap a run can be reported without: one of its limits, or the half of the memory cap that
 * bounds what a run pages out to disk. An engine whose host lacks it still binds the
 * memory a run holds, so that half is reported on its own rather than the whole memory cap.
 */
export type ReportedCap = keyof SandboxLimits | "memorySwap";

/** Each cap by the name the probe and a run's notice give it, in the order they are listed. */
export const CAP_NAMES: Readonly<Record<ReportedCap, string>> = {
  processes: "processes",
  memoryBytes: "memory",
  memorySwap: "memory-swap",
  cpus: "cpu",
  wallClockSeconds: "wall-clock",
  scratchBytes: "scratch",
};

/** The caps `backend` runs without; `scope`: it runs in a systemd user scope. */
export function unenforcedCaps(backend: SandboxedBackend, scope = false): (keyof SandboxLimits)[] {
  return (Object.entries(CAP_ENFORCEMENT[backend]) as [keyof SandboxLimits, CapEnforcer][])
    .filter(([, by]) => by === "unenforced" || (by === "scope" && !scope)).map(([cap]) => cap);
}

/**
 * The caps a chosen backend runs without: bubblewrap in a user scope lacks none of the three, and
 * a container lacks those its engine drops on this host.
 */
export function capsWithout(backend: OfferedBackend): ReportedCap[] {
  const without: readonly ReportedCap[] = unenforcedCaps(
    backend.kind,
    backend.kind === "bwrap" && backend.scope,
  );
  const dropped = backend.kind === "container" ? backend.dropped : [];
  return (Object.keys(CAP_NAMES) as ReportedCap[])
    .filter((cap) => without.includes(cap) || dropped.includes(cap));
}

/** The cap each limit an engine reports carries: one limit, one cap, for podman and docker. */
export const ENGINE_CAPS: Readonly<Record<keyof EngineLimits, ReportedCap>> = {
  memory: "memoryBytes",
  swap: "memorySwap",
  pids: "processes",
  cpuQuota: "cpus",
};

/** The caps an engine drops from a run on a host that can apply only `limits`. */
export function engineDrops(limits: EngineLimits): ReportedCap[] {
  const lacking = (Object.keys(ENGINE_CAPS) as (keyof EngineLimits)[]).filter((l) => !limits[l]);
  return lacking.map((l) => ENGINE_CAPS[l]);
}

/**
 * What stopping a run cannot reach, per backend; `null` where it reaches every process. A
 * container's init and bubblewrap's PID namespace take every process in them when the run ends.
 * `sandbox-exec` has neither: the stop kills the run's process group, and a process that called
 * `setsid` has left it. That process stays under the profile (no network, no home, writes only to
 * the scratch folder), and the run stops waiting on its output soon after the command ends.
 */
export const STOP_LIMIT: Readonly<Record<SandboxedBackend, string | null>> = {
  container: null,
  bwrap: null,
  seatbelt: "a process that leaves the run's process group is not stopped with the run",
};
