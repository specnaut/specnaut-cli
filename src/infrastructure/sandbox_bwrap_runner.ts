import { join } from "@std/path";
import {
  type RunOutcome,
  SandboxRefused,
  type SandboxRunner,
} from "../application/sandbox_ports.ts";
import type { SandboxPolicy } from "../domain/sandbox.ts";
import { bwrapArgs, scopeArgs } from "../domain/sandbox_bwrap_args.ts";
import { isFilterArch, SECCOMP_FD, seccompFilter } from "../domain/sandbox_seccomp.ts";
import type { ProcessLauncher, Started } from "./sandbox_process.ts";
import { untilWallClock } from "./sandbox_wall_clock.ts";

/**
 * Bubblewrap reads its syscall filter from a descriptor. A fixed shell line moves our pipe onto
 * {@link SECCOMP_FD}, gives the command `/dev/null` as input, and becomes bubblewrap; the filter
 * goes down the pipe. bubblewrap reads it whole and closes it before the command starts.
 */
const MOVE_FILTER = `exec ${SECCOMP_FD}<&0 </dev/null; exec "$@"`;

/**
 * In a systemd user scope, the shell line first creates the marker it is given: it runs only once
 * the scope is up, so a marker missing after the run means the scope never started.
 */
const SCOPED_MOVE_FILTER = `: > "$1" || exit 125; shift; ${MOVE_FILTER}`;

export class BwrapRunner implements SandboxRunner {
  readonly #filter: Uint8Array;

  /**
   * `path` finds `bwrap` and `systemd-run` as the probe found them; the sandbox's own PATH is the
   * policy's. `scope`: run in a systemd user scope, which caps memory, processes and CPU, reached
   * through `bus` (`userBus`), which is given to `systemd-run` alone.
   */
  constructor(
    arch: string,
    readonly launcher: ProcessLauncher,
    readonly path: string,
    readonly scope = false,
    readonly bus: Readonly<Record<string, string>> = {},
  ) {
    if (!isFilterArch(arch)) throw new Error(`no syscall filter for ${arch}`);
    this.#filter = seccompFilter(arch);
  }

  run(policy: SandboxPolicy, command: readonly string[]): Promise<RunOutcome> {
    const bwrap = ["bwrap", ...bwrapArgs(policy, command)];
    if (this.scope) return this.#scoped(policy, bwrap);
    return untilWallClock(
      this.#start("/bin/sh", ["-c", MOVE_FILTER, "sh", ...bwrap]),
      wall(policy),
    );
  }

  /**
   * The run inside a user scope. A scope that did not start ran nothing: it is refused with its
   * cause, never turned into a run without the caps it was chosen for.
   */
  async #scoped(policy: SandboxPolicy, bwrap: readonly string[]): Promise<RunOutcome> {
    const folder = await Deno.makeTempDir({ prefix: "specnaut-scope-" });
    try {
      const marker = join(folder, "started");
      const [cmd, ...prefix] = scopeArgs(policy);
      const line = ["/bin/sh", "-c", SCOPED_MOVE_FILTER, "sh", marker, ...bwrap];
      const started = this.#start(cmd, [...prefix, ...line], this.bus);
      const outcome = await untilWallClock(started, wall(policy));
      if (outcome.kind === "exited" && !(await present(marker))) {
        throw new SandboxRefused(`the systemd user scope did not start (exit ${outcome.code})`);
      }
      return outcome;
    } finally {
      await Deno.remove(folder, { recursive: true });
    }
  }

  /** `cmd` with PATH and `extra` as its whole environment, the filter on its input. */
  #start(
    cmd: string,
    args: readonly string[],
    extra: Readonly<Record<string, string>> = {},
  ): Started {
    const env = { ...extra, PATH: this.path };
    return this.launcher.start({ cmd, args, env, stdin: this.#filter });
  }
}

const wall = (policy: SandboxPolicy) => policy.limits.wallClockSeconds;

/** Whether `path` exists. */
async function present(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}
