import type { RunOutcome, SandboxRunner } from "../application/sandbox_ports.ts";
import type { SandboxPolicy } from "../domain/sandbox.ts";
import { bwrapArgs } from "../domain/sandbox_args.ts";
import { isFilterArch, SECCOMP_FD, seccompFilter } from "../domain/sandbox_seccomp.ts";
import type { ProcessLauncher } from "./sandbox_process.ts";
import { untilWallClock } from "./sandbox_wall_clock.ts";

/**
 * Bubblewrap reads its syscall filter from a descriptor. A fixed shell line moves our pipe onto
 * {@link SECCOMP_FD}, gives the command `/dev/null` as input, and becomes bubblewrap; the filter
 * goes down the pipe. bubblewrap reads it whole and closes it before the command starts.
 */
const MOVE_FILTER = `exec ${SECCOMP_FD}<&0 </dev/null; exec "$@"`;

export class BwrapRunner implements SandboxRunner {
  readonly #filter: Uint8Array;

  /** `path` finds `bwrap` as the probe found it; the sandbox's own PATH is the policy's. */
  constructor(arch: string, readonly launcher: ProcessLauncher, readonly path: string) {
    if (!isFilterArch(arch)) throw new Error(`no syscall filter for ${arch}`);
    this.#filter = seccompFilter(arch);
  }

  run(policy: SandboxPolicy, command: readonly string[]): Promise<RunOutcome> {
    const started = this.launcher.start({
      cmd: "/bin/sh",
      args: ["-c", MOVE_FILTER, "sh", "bwrap", ...bwrapArgs(policy, command)],
      env: { PATH: this.path },
      stdin: this.#filter,
    });
    return untilWallClock(started, policy.limits.wallClockSeconds);
  }
}
