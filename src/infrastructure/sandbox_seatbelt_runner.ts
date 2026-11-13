import type { RunOutcome, SandboxRunner } from "../application/sandbox_ports.ts";
import type { SandboxPolicy } from "../domain/sandbox.ts";
import { seatbeltProfile } from "../domain/sandbox_seatbelt.ts";
import type { ProcessLauncher } from "./sandbox_process.ts";
import {
  HdiutilVolumes,
  type ScratchVolume,
  type ScratchVolumes,
} from "./sandbox_scratch_volume.ts";
import { DRAIN_GRACE_SECONDS } from "./sandbox_wall_clock.ts";
import { watched } from "./sandbox_watched.ts";
import { watchdogSpec } from "./sandbox_watchdog.ts";

/**
 * `sandbox-exec` with the policy's profile, in its working folder, with its environment only. The
 * sandbox's home and temp are host folders here, so they are made, new and empty, before the run,
 * on the volume that caps the scratch (`CAP_ENFORCEMENT`): it is attached on the policy's scratch
 * folder first, and detached after the run however it ended. A volume left attached never turns
 * a run that happened into one that did not: its outcome stands, with the volume's word on it. The
 * watchdog that ends a run we no longer watch ends its volume after it.
 */
export class SeatbeltRunner implements SandboxRunner {
  constructor(
    readonly launcher: ProcessLauncher,
    readonly volumes: ScratchVolumes = new HdiutilVolumes(launcher),
  ) {}

  async run(policy: SandboxPolicy, command: readonly string[]): Promise<RunOutcome> {
    const volume = await this.volumes.attach(policy.scratch, policy.limits.scratchBytes);
    let outcome: RunOutcome;
    try {
      outcome = await this.#sandboxed(policy, command, volume.removal);
    } catch (err) {
      throw withVolumeLeft(err, await detachFailure(volume));
    }
    const left = await detachFailure(volume);
    return left === null ? outcome : { ...outcome, volumeLeft: left };
  }

  /** The run itself, on the volume's home and temp, its watchdog ending with `removal`. */
  async #sandboxed(
    policy: SandboxPolicy,
    command: readonly string[],
    removal: readonly string[],
  ): Promise<RunOutcome> {
    for (const folder of policy.writes) await Deno.mkdir(folder, { mode: 0o700 });
    const started = this.launcher.start({
      cmd: "/usr/bin/sandbox-exec",
      args: ["-p", seatbeltProfile(policy), "--", ...command],
      env: policy.env,
      cwd: policy.workdir,
    });
    const seconds = policy.limits.wallClockSeconds;
    const watchdog = (pid: number) => watchdogSpec(pid, seconds + DRAIN_GRACE_SECONDS, removal);
    return await watched(this.launcher, started, seconds, watchdog);
  }
}

/** `null` once `volume` is detached and its image deleted; else what failed. */
async function detachFailure(volume: ScratchVolume): Promise<string | null> {
  try {
    await volume.detach();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** A run's error, its message naming the volume left after it, if one was. */
function withVolumeLeft(err: unknown, left: string | null): unknown {
  if (left === null) return err;
  const why = err instanceof Error ? err.message : String(err);
  return new Error(`${why}; the scratch volume may be left: ${left}`, { cause: err });
}
