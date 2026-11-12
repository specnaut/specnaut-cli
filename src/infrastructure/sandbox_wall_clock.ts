import type { RunOutcome } from "../application/sandbox_ports.ts";
import type { Started } from "./sandbox_process.ts";

/**
 * The wall clock of a sandboxed run: no backend's own options end a run on time, so the launcher's
 * caller applies it, here, around the process it started.
 */

/**
 * The command's outcome, or `timed_out` once `seconds` pass: then `halt` runs (what stops a run
 * the launcher alone cannot, such as a container), the process is stopped, and its end awaited.
 */
export async function untilWallClock(
  started: Started,
  seconds: number,
  halt: () => Promise<void> = () => Promise.resolve(),
): Promise<RunOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((ok) => (timer = setTimeout(() => ok("late"), seconds * 1000)));
  try {
    const first = await Promise.race([started.exited, late]);
    if (first !== "late") return { kind: "exited", code: first };
    try {
      await halt();
    } finally {
      started.stop();
    }
    await started.exited;
    return { kind: "timed_out", seconds };
  } finally {
    clearTimeout(timer);
  }
}
