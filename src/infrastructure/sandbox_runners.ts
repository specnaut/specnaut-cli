import { encodeHex } from "@std/encoding/hex";
import type { RunnableBackend, RunOutcome, SandboxRunner } from "../application/sandbox_ports.ts";
import type { Engine, SandboxPolicy } from "../domain/sandbox.ts";
import { containerArgs, type ContainerRun } from "../domain/sandbox_args.ts";
import { seatbeltProfile } from "../domain/sandbox_seatbelt.ts";
import { armExitTrap } from "./exit_trap.ts";
import { removalOf, removed, thenRemoved } from "./sandbox_container_removal.ts";
import { BwrapRunner } from "./sandbox_bwrap_runner.ts";
import { engineRunEnv } from "./sandbox_engine_env.ts";
import type { ProcessLauncher, ProcessSpec, Started } from "./sandbox_process.ts";
import { DRAIN_GRACE_SECONDS, type Halt, untilWallClock } from "./sandbox_wall_clock.ts";
import { watchdogSpec } from "./sandbox_watchdog.ts";

/**
 * One runner per backend. Each launches exactly what the domain generated for the policy, adds
 * nothing to it, and applies the wall clock, which no backend's own options can. The other caps
 * are applied where `CAP_ENFORCEMENT` puts them in the arguments, and nowhere else: what a
 * backend runs without is `unenforcedCaps`. A run that would outlive us were we killed (a
 * container, `sandbox-exec`) has a watchdog beside it that ends it at the wall clock plus the
 * drain grace.
 */

/**
 * The run's container, named so it can be removed when the wall clock runs out or we are stopped.
 * The engine's client, and each removal, start with `engineRunEnv` of ours, read at the run, the
 * client with the options it gives before `run`. What it wrote is released once the run is over;
 * on an interrupt it is left, as the watchdog's removal still reads it.
 */
export class ContainerRunner implements SandboxRunner {
  constructor(
    readonly engine: Engine,
    readonly image: string,
    readonly launcher: ProcessLauncher,
    /** The caps the engine drops on this host and its CPUs, as the offered backend carries them. */
    readonly caps: Pick<ContainerRun, "dropped" | "cpus">,
    readonly name: () => string = containerName,
    readonly hostEnv: () => Readonly<Record<string, string>> = () => Deno.env.toObject(),
  ) {}

  /**
   * A container outlives its client, so it is removed however the run ends: at the wall clock, on
   * an interrupt, and once the run is over, which covers a client that ended early and a watchdog
   * that never started. A container left is said once, by the run's outcome or its error.
   */
  async run(policy: SandboxPolicy, command: readonly string[]): Promise<RunOutcome> {
    const name = this.name();
    const { dropped, cpus } = this.caps;
    const run = { image: this.image, name, engine: this.engine, dropped, cpus };
    const args = containerArgs(policy, run, command);
    const { env, globals, release } = await engineRunEnv(this.engine, this.hostEnv());
    const remove = removalOf(this.engine, name, env);
    const disarm = armExitTrap(() => void this.launcher.runSync(remove));
    try {
      const seconds = policy.limits.wallClockSeconds;
      return await thenRemoved(this.launcher, remove, () => {
        const started = this.launcher.start({ cmd: this.engine, args: [...globals, ...args], env });
        const halt = () => removed(this.launcher, remove);
        return watched(this.launcher, started, seconds, watchdogOf(remove, seconds), halt);
      });
    } finally {
      release();
      disarm();
    }
  }
}

/** The watchdog of a container's run: it ends with `remove`, in the removal's environment. */
function watchdogOf(remove: ProcessSpec, seconds: number): (pid: number) => ProcessSpec {
  const removal = [remove.cmd, ...remove.args];
  return (pid) => watchdogSpec(pid, seconds + DRAIN_GRACE_SECONDS, removal, remove.env);
}

function containerName(): string {
  return `specnaut-sandbox-${encodeHex(crypto.getRandomValues(new Uint8Array(8)))}`;
}

/**
 * `sandbox-exec` with the policy's profile, in its working folder, with its environment only. The
 * sandbox's home and temp are host folders here, so they are made, new and empty, before the run.
 */
export class SeatbeltRunner implements SandboxRunner {
  constructor(readonly launcher: ProcessLauncher) {}

  async run(policy: SandboxPolicy, command: readonly string[]): Promise<RunOutcome> {
    for (const folder of policy.writes) await Deno.mkdir(folder, { mode: 0o700 });
    const started = this.launcher.start({
      cmd: "/usr/bin/sandbox-exec",
      args: ["-p", seatbeltProfile(policy), "--", ...command],
      env: policy.env,
      cwd: policy.workdir,
    });
    const seconds = policy.limits.wallClockSeconds;
    const watchdog = (pid: number) => watchdogSpec(pid, seconds + DRAIN_GRACE_SECONDS);
    return await watched(this.launcher, started, seconds, watchdog);
  }
}

/**
 * `started` run to its end under the wall clock, beside its watchdog (`watchdog` of its pid), which
 * is stopped once the run has ended. A watchdog that cannot start stops the run: it never goes
 * unwatched.
 */
async function watched(
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

/**
 * The host facts a runner needs: the architecture its filter is for, the PATH that finds bwrap,
 * and the user bus (`userBus`) a systemd user scope is reached through.
 */
export type RunnerHost = {
  readonly arch: string;
  readonly path: string;
  readonly bus: Readonly<Record<string, string>>;
};

export function runnerFor(
  backend: RunnableBackend,
  launcher: ProcessLauncher,
  host: RunnerHost,
): SandboxRunner {
  switch (backend.kind) {
    case "container":
      return new ContainerRunner(backend.engine, backend.image, launcher, backend);
    case "bwrap":
      return new BwrapRunner(host.arch, launcher, host.path, backend.scope, host.bus);
    case "seatbelt":
      return new SeatbeltRunner(launcher);
  }
}
