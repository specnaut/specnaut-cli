import { encodeHex } from "@std/encoding/hex";
import {
  type RunnableBackend,
  type RunOutcome,
  SandboxRefused,
  type SandboxRunner,
} from "../application/sandbox_ports.ts";
import type { Engine, SandboxPolicy } from "../domain/sandbox.ts";
import { containerArgs, type ContainerRun } from "../domain/sandbox_args.ts";
import { armExitTrap } from "./exit_trap.ts";
import { removalOf, removed, thenRemoved } from "./sandbox_container_removal.ts";
import { BwrapRunner } from "./sandbox_bwrap_runner.ts";
import { engineRunEnv, type RunEnv } from "./sandbox_engine_env.ts";
import type { ProcessLauncher, ProcessSpec } from "./sandbox_process.ts";
import { programOnPath } from "./program_on_path.ts";
import { SeatbeltRunner } from "./sandbox_seatbelt_runner.ts";
import { DRAIN_GRACE_SECONDS } from "./sandbox_wall_clock.ts";
import { watched } from "./sandbox_watched.ts";
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
 * client with the options it gives before `run`. What it wrote is released once the run is over,
 * and on an interrupt as `releaseOnExit` says: podman's is left for the watchdog's removal. The
 * client and each removal are started at `program`, the engine's file as the probe found it, so
 * neither the spawn nor the watchdog's shell looks it up again.
 */
export class ContainerRunner implements SandboxRunner {
  constructor(
    readonly engine: Engine,
    readonly program: string,
    readonly image: string,
    readonly launcher: ProcessLauncher,
    /** The caps the engine drops on this host and its CPUs, as the offered backend carries them. */
    readonly caps: Pick<ContainerRun, "dropped" | "cpus">,
    readonly name: () => string = containerName,
    readonly hostEnv: () => Readonly<Record<string, string>> = () => Deno.env.toObject(),
  ) {}

  /**
   * The run's engine environment is written first: the arguments name the syscall profile in it.
   * What was written goes once the run is over, however it ends, a refused run included.
   */
  async run(policy: SandboxPolicy, command: readonly string[]): Promise<RunOutcome> {
    const name = this.name();
    const runEnv = await engineRunEnv(this.engine, this.hostEnv());
    try {
      const { dropped, cpus } = this.caps;
      const run = { image: this.image, name, engine: this.engine, dropped, cpus };
      const args = containerArgs(policy, { ...run, seccomp: runEnv.seccomp }, command);
      return await this.#removed(name, runEnv, args, policy.limits.wallClockSeconds);
    } finally {
      runEnv.release();
    }
  }

  /**
   * A container outlives its client, so it is removed however the run ends: at the wall clock, on
   * an interrupt, and once the run is over, which covers a client that ended early and a watchdog
   * that never started. A container left is said once, by the run's outcome or its error.
   */
  async #removed(name: string, runEnv: RunEnv, args: string[], seconds: number) {
    const { env, globals } = runEnv;
    const remove = removalOf(this.engine, this.program, name, env);
    const disarm = armExitTrap(() => {
      this.launcher.runSync(remove);
      runEnv.releaseOnExit();
    });
    try {
      return await thenRemoved(this.launcher, remove, () => {
        const client = { cmd: this.program, args: [...globals, ...args], env };
        const started = this.launcher.start(client);
        const halt = () => removed(this.launcher, remove);
        return watched(this.launcher, started, seconds, watchdogOf(remove, seconds), halt);
      });
    } finally {
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
 * The host facts a runner needs: the architecture its filter is for, the PATH that finds its
 * engine (the probe's), and the user bus (`userBus`) a systemd user scope is reached through.
 * Each program a runner starts by name is found on that PATH here, as the probe found it, and
 * handed to the runner as that file.
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
      return containerRunner(backend, launcher, host.path);
    case "bwrap": {
      const systemdRun = backend.scope ? programAt("systemd-run", host.path) : null;
      const bwrap = programAt("bwrap", host.path);
      return new BwrapRunner(host.arch, launcher, host.path, bwrap, systemdRun, host.bus);
    }
    case "seatbelt":
      return new SeatbeltRunner(launcher);
  }
}

/** The engine's client and each removal start with ours, PATH the probe's, at the engine's file. */
function containerRunner(
  backend: Extract<RunnableBackend, { kind: "container" }>,
  launcher: ProcessLauncher,
  path: string,
): ContainerRunner {
  const env = () => ({ ...Deno.env.toObject(), PATH: path });
  const { engine, image } = backend;
  const program = programAt(engine, path);
  return new ContainerRunner(engine, program, image, launcher, backend, undefined, env);
}

/** The file `name` is on `path`, as the probe found it; one gone since is refused, never guessed. */
function programAt(name: string, path: string): string {
  const program = programOnPath(name, path);
  if (program === undefined) throw new SandboxRefused(`${name} is no longer on the PATH`);
  return program;
}
