import type { RunOutcome, SandboxRunner } from "../application/sandbox_ports.ts";
import type { SandboxPolicy } from "../domain/sandbox.ts";
import { seatbeltProfile } from "../domain/sandbox_seatbelt.ts";
import type { ProcessLauncher } from "./sandbox_process.ts";
import { HdiutilVolumes, type ScratchVolumes } from "./sandbox_scratch_volume.ts";
import { DRAIN_GRACE_SECONDS } from "./sandbox_wall_clock.ts";
import { watched } from "./sandbox_watched.ts";
import { watchdogSpec } from "./sandbox_watchdog.ts";

/**
 * `sandbox-exec` with the policy's profile, in its working folder, with its environment only. The
 * sandbox's home and temp are host folders here, so they are made, new and empty, before the run,
 * on the volume that caps the scratch (`CAP_ENFORCEMENT`): it is attached on the policy's scratch
 * folder first, and detached after the run however it ended. The watchdog that ends a run we no
 * longer watch ends its volume after it.
 */
export class SeatbeltRunner implements SandboxRunner {
  constructor(
    readonly launcher: ProcessLauncher,
    readonly volumes: ScratchVolumes = new HdiutilVolumes(launcher),
  ) {}

  async run(policy: SandboxPolicy, command: readonly string[]): Promise<RunOutcome> {
    const volume = await this.volumes.attach(policy.scratch, policy.limits.scratchBytes);
    try {
      for (const folder of policy.writes) await Deno.mkdir(folder, { mode: 0o700 });
      const started = this.launcher.start({
        cmd: "/usr/bin/sandbox-exec",
        args: ["-p", seatbeltProfile(policy), "--", ...command],
        env: policy.env,
        cwd: policy.workdir,
      });
      const seconds = policy.limits.wallClockSeconds;
      const grace = seconds + DRAIN_GRACE_SECONDS;
      return await watched(
        this.launcher,
        started,
        seconds,
        (pid) => watchdogSpec(pid, grace, volume.removal),
      );
    } finally {
      await volume.detach();
    }
  }
}
