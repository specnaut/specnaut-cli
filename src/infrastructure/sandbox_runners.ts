import { encodeHex } from "@std/encoding/hex";
import type { RunnableBackend, RunOutcome, SandboxRunner } from "../application/sandbox_ports.ts";
import type { Engine, SandboxPolicy } from "../domain/sandbox.ts";
import { bwrapArgs, containerArgs } from "../domain/sandbox_args.ts";
import { seatbeltProfile } from "../domain/sandbox_seatbelt.ts";
import { isFilterArch, SECCOMP_FD, seccompFilter } from "../domain/sandbox_seccomp.ts";
import { armExitTrap } from "./exit_trap.ts";
import { type ProcessLauncher, untilWallClock } from "./sandbox_process.ts";

/**
 * One runner per backend. Each launches exactly what the domain generated for the policy, adds
 * nothing to it, and applies the wall clock, which no backend's own options can. The other caps
 * are applied where `CAP_ENFORCEMENT` puts them in the arguments, and nowhere else: what a
 * backend runs without is `unenforcedCaps`.
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
    const remove = { cmd: this.engine, args: ["rm", "--force", name], env: "host" } as const;
    // A container outlives its client: an interrupt removes it rather than leave it running.
    const disarm = armExitTrap(() => void this.launcher.runSync(remove));
    try {
      const started = this.launcher.start({ cmd: this.engine, args, env: "host" });
      return await untilWallClock(started, policy.limits.wallClockSeconds, async () => {
        await this.launcher.start(remove).exited;
      });
    } finally {
      disarm();
    }
  }
}

function containerName(): string {
  return `specnaut-sandbox-${encodeHex(crypto.getRandomValues(new Uint8Array(8)))}`;
}

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
    return await untilWallClock(started, policy.limits.wallClockSeconds);
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
