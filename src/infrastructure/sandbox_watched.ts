import type { RunOutcome } from "../application/sandbox_ports.ts";
import type { ProcessLauncher, ProcessSpec, Started } from "./sandbox_process.ts";
import { type Halt, untilWallClock } from "./sandbox_wall_clock.ts";

/**
 * `started` run to its end under the wall clock, beside its watchdog (`watchdog` of its pid), which
 * is stopped once the run has ended. A watchdog that cannot start stops the run: it never goes
 * unwatched.
 */
export async function watched(
  launcher: ProcessLauncher,
  started: Started,
  seconds: number,
  watchdogOf: (pid: number) => ProcessSpec,
  halt?: Halt,
): Promise<RunOutcome> {
  const watchdog = startWatchdog(launcher, started, watchdogOf);
  try {
    return await untilWallClock(started, seconds, halt);
  } finally {
    watchdog.stop();
    await watchdog.exited;
  }
}

/** The watchdog of `started`; if it cannot start, the run is stopped and the failure raised. */
function startWatchdog(
  launcher: ProcessLauncher,
  started: Started,
  watchdogOf: (pid: number) => ProcessSpec,
): Started {
  try {
    return launcher.start(watchdogOf(started.pid));
  } catch (err) {
    started.stop();
    throw err;
  }
}
