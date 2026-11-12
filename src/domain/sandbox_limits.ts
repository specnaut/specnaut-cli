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

/** Who applies a cap: the backend's own arguments, or the launcher around it. */
export type CapEnforcer = "arguments" | "launcher";

const BY_LAUNCHER: Readonly<Record<keyof SandboxLimits, CapEnforcer>> = {
  processes: "launcher",
  memoryBytes: "launcher",
  cpus: "launcher",
  wallClockSeconds: "launcher",
  scratchBytes: "launcher",
};

/**
 * Where each cap is applied, per backend. The wall clock is always the launcher's: no backend
 * option ends a run on time. Neither bubblewrap nor `sandbox-exec` can cap processes, memory or
 * CPU, so the launcher sets those as resource limits on the process it starts.
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
  bwrap: { ...BY_LAUNCHER, scratchBytes: "arguments" },
  seatbelt: BY_LAUNCHER,
};
