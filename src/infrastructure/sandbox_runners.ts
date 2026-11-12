import { encodeHex } from "@std/encoding/hex";
import type { RunnableBackend, RunOutcome, SandboxRunner } from "../application/sandbox_ports.ts";
import type { Engine, SandboxPolicy } from "../domain/sandbox.ts";
import { containerArgs } from "../domain/sandbox_args.ts";
import { seatbeltProfile } from "../domain/sandbox_seatbelt.ts";
import { armExitTrap } from "./exit_trap.ts";
import { BwrapRunner } from "./sandbox_bwrap_runner.ts";
import type { ProcessLauncher, ProcessSpec, Started } from "./sandbox_process.ts";
import { DRAIN_GRACE_SECONDS, untilWallClock } from "./sandbox_wall_clock.ts";
import { watchdogSpec } from "./sandbox_watchdog.ts";

/**
 * One runner per backend. Each launches exactly what the domain generated for the policy, adds
 * nothing to it, and applies the wall clock, which no backend's own options can. The other caps
 * are applied where `CAP_ENFORCEMENT` puts them in the arguments, and nowhere else: what a
 * backend runs without is `unenforcedCaps`. A run that would outlive us were we killed (a
 * container, `sandbox-exec`) has a watchdog beside it that ends it at the wall clock plus the
 * drain grace.
 */

/** The run's container, named so it can be removed when the wall clock runs out or we are stopped. */
export class ContainerRunner implements SandboxRunner {
  constructor(
    readonly engine: Engine,
    readonly image: string,
    readonly launcher: ProcessLauncher,
    readonly name: () => string = containerName,
  ) {}

  async run(policy: SandboxPolicy, command: readonly string[]): Promise<RunOutcome> {
    const name = this.name();
    const args = containerArgs(policy, { image: this.image, name }, command);
    const remove = removalOf(this.engine, name);
    // A container outlives its client: an interrupt removes it rather than leave it running.
    const disarm = armExitTrap(() => void this.launcher.runSync(remove));
    try {
      const started = this.launcher.start({ cmd: this.engine, args, env: "host" });
      const removal = [remove.cmd, ...remove.args];
      const halt = async () => {
        await this.launcher.start(remove).exited;
      };
      return await watched(this.launcher, started, policy.limits.wallClockSeconds, removal, halt);
    } finally {
      disarm();
    }
  }
}

/** Removes the named container; what the engine prints (the name) never passes for the run's. */
function removalOf(engine: Engine, name: string): ProcessSpec {
  return { cmd: engine, args: ["rm", "--force", name], env: "host", stdout: "discarded" };
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
    return await watched(this.launcher, started, policy.limits.wallClockSeconds, []);
  }
}

/**
 * `started` run to its end under the wall clock, beside its watchdog, which is stopped once the
 * run has ended. A watchdog that cannot start stops the run: it never goes unwatched.
 */
async function watched(
  launcher: ProcessLauncher,
  started: Started,
  seconds: number,
  removal: readonly string[],
  halt?: () => Promise<void>,
): Promise<RunOutcome> {
  const watchdog = startWatchdog(launcher, started, seconds, removal);
  try {
    return await untilWallClock(started, seconds, halt);
  } finally {
    watchdog.stop();
    await watchdog.exited;
  }
}

/**
 * The watchdog of `started`, past the wall clock and the drain grace; if it cannot start, the run
 * is stopped and the failure raised.
 */
function startWatchdog(
  launcher: ProcessLauncher,
  started: Started,
  seconds: number,
  removal: readonly string[],
): Started {
  try {
    return launcher.start(watchdogSpec(started.pid, seconds + DRAIN_GRACE_SECONDS, removal));
  } catch (err) {
    started.stop();
    throw err;
  }
}

/** The host facts a runner needs: the architecture its filter is for, the PATH that finds bwrap. */
export type RunnerHost = { readonly arch: string; readonly path: string };

export function runnerFor(
  backend: RunnableBackend,
  launcher: ProcessLauncher,
  host: RunnerHost,
): SandboxRunner {
  switch (backend.kind) {
    case "container":
      return new ContainerRunner(backend.engine, backend.image, launcher);
    case "bwrap":
      return new BwrapRunner(host.arch, launcher, host.path);
    case "seatbelt":
      return new SeatbeltRunner(launcher);
  }
}
