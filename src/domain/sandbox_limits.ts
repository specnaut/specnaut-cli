/**
 * The resource caps of a sandboxed run: data the policy carries, so a fork bomb, a memory bomb or
 * a hang ends at a known bound. `sandboxPolicy` in `sandbox.ts` decides that a policy carries them.
 */

import type { SandboxedBackend } from "./sandbox.ts";

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
 * Who applies a cap: the backend's own arguments, the launcher around it, or nobody. A cap a
 * backend cannot enforce is named as such here, never claimed: the run goes ahead without it.
 */
export type CapEnforcer = "arguments" | "launcher" | "unenforced";

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
 * option ends a run on time. Neither bubblewrap nor `sandbox-exec` can cap processes, memory or
 * CPU, and nothing around them does either; bubblewrap caps its scratch tmpfs by size.
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
  bwrap: { ...WALL_CLOCK_ONLY, scratchBytes: "arguments" },
  seatbelt: WALL_CLOCK_ONLY,
};

/** The caps `backend` runs without. */
export function unenforcedCaps(backend: SandboxedBackend): (keyof SandboxLimits)[] {
  return (Object.entries(CAP_ENFORCEMENT[backend]) as [keyof SandboxLimits, CapEnforcer][])
    .filter(([, by]) => by === "unenforced").map(([cap]) => cap);
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
