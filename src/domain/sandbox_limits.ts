/**
 * The resource caps of a sandboxed run: data the policy carries, so a fork bomb, a memory bomb or
 * a hang ends at a known bound. `sandboxPolicy` in `sandbox.ts` decides that a policy carries them.
 */

export type SandboxLimits = {
  readonly processes: number;
  readonly memoryBytes: number;
  readonly cpus: number;
  readonly wallClockSeconds: number;
  /** Per scratch folder. */
  readonly scratchBytes: number;
};

const GIB = 1024 ** 3;

/**
 * Enough for a test suite; a fork bomb, a memory bomb or a hang stops at them. A container's
 * arguments carry all but the wall clock, bubblewrap's the scratch cap; the launcher does the rest.
 */
export const LIMITS: SandboxLimits = {
  processes: 512,
  memoryBytes: 4 * GIB,
  cpus: 2,
  wallClockSeconds: 30 * 60,
  scratchBytes: GIB,
};
