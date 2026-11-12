import type { RunOutcome } from "../application/sandbox_ports.ts";
import type { Started } from "./sandbox_process.ts";

/**
 * The wall clock of a sandboxed run: no backend's own options end a run on time, so the launcher's
 * caller applies it, here, around the process it started.
 */

/**
 * How long a run's output is still copied once its command has ended or been stopped. Whatever
 * holds the pipes past it left the process group: the run stops waiting on it, so a run ends by
 * its wall clock plus this grace.
 */
export const DRAIN_GRACE_SECONDS = 5;

/**
 * What stops a run the launcher alone cannot, such as a container: `null` once done, else what
 * failed, which the outcome then names. A halt that throws is raised, after the stop.
 */
export type Halt = () => Promise<string | null>;

/**
 * The command's outcome, or `timed_out` once `seconds` pass: then `halt` runs and the process is
 * stopped, even when `halt` fails. Either way its output is then copied for at most `grace`
 * seconds more.
 */
export async function untilWallClock(
  started: Started,
  seconds: number,
  halt: Halt = () => Promise.resolve(null),
  grace = DRAIN_GRACE_SECONDS,
): Promise<RunOutcome> {
  const outcome = await endOf(started, seconds, halt);
  const timer = setTimeout(() => letGo(started, grace), grace * 1000);
  try {
    await started.exited;
  } finally {
    clearTimeout(timer);
  }
  return outcome;
}

/** Stops waiting on an output still held open `grace` seconds after the command, and says so. */
function letGo(started: Started, grace: number): void {
  console.error(
    `warning: the sandbox's output was still held open ${grace} s after its command ended, ` +
      "by a process that left the run; the run no longer waits on it",
  );
  started.release();
}

/** How the command ended: by itself, or stopped once `seconds` passed. */
async function endOf(
  started: Started,
  seconds: number,
  halt: Halt,
): Promise<RunOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((ok) => (timer = setTimeout(() => ok("late"), seconds * 1000)));
  try {
    const first = await Promise.race([started.ended, late]);
    if (first !== "late") return { kind: "exited", code: first };
    const haltFailed = await haltThenStop(started, halt);
    return haltFailed === null
      ? { kind: "timed_out", seconds }
      : { kind: "timed_out", seconds, haltFailed };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs `halt`, then stops the process even when `halt` failed, awaits its end, and returns what
 * `halt` says failed.
 */
async function haltThenStop(started: Started, halt: Halt): Promise<string | null> {
  let failed: string | null;
  try {
    failed = await halt();
  } finally {
    started.stop();
  }
  await started.ended;
  return failed;
}
