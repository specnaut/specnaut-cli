import { armExitTrap } from "./exit_trap.ts";

/**
 * How a sandbox's launcher process is started and stopped. The process gets no terminal: its
 * standard input is the bytes given (then closed) or nothing, and its output is copied to ours
 * through pipes, so no descriptor of our terminal reaches the sandbox. On POSIX it leads a process
 * group of its own, and stopping it kills the whole group: whatever the command left running in
 * the background goes too, when it ends, when the wall clock runs out, and when we are interrupted.
 * A process that left the group is out of the kill's reach; its hold on the output is bounded by
 * `DRAIN_GRACE_SECONDS` (`sandbox_wall_clock.ts`).
 */

export type ProcessSpec = {
  readonly cmd: string;
  readonly args: readonly string[];
  /** Its whole environment; `host` (ours) only for a watchdog that runs nothing but host tools. */
  readonly env: Readonly<Record<string, string>> | "host";
  readonly cwd?: string;
  readonly stdin?: Uint8Array;
  /** `discarded` for a helper whose output must never pass for the command's own; `copied` else. */
  readonly stdout?: "copied" | "discarded";
};

export type Started = {
  /** Its process id, which on POSIX is also its process group's. */
  readonly pid: number;
  /** The exit code, as soon as the process has ended; its process group is killed then. */
  readonly ended: Promise<number>;
  /** The exit code, once the process has ended and its output is copied, or let go by `release`. */
  readonly exited: Promise<number>;
  /**
   * Kills it and its process group; a process already gone is not an error. Once `ended` has
   * settled it signals nothing: the group was killed then, and its id may since be another's.
   */
  stop(): void;
  /**
   * Stops copying its output. A process that left the group holds the pipes open for as long as
   * it lives, and the group's kill does not reach it; `exited` then settles without it.
   */
  release(): void;
};

export interface ProcessLauncher {
  start(spec: ProcessSpec): Started;
  /** Runs `spec` to its end, synchronously: for the cleanup an interrupt runs. */
  runSync(spec: ProcessSpec): number;
}

const GROUPS = Deno.build.os !== "windows";

export class DenoProcessLauncher implements ProcessLauncher {
  #sinks?: Sinks;

  constructor(
    readonly out: WritableStream<Uint8Array> = Deno.stdout.writable,
    readonly err: WritableStream<Uint8Array> = Deno.stderr.writable,
  ) {}

  start(spec: ProcessSpec): Started {
    const child = command(spec, spec.stdin ? "piped" : "null").spawn();
    // Once the group's last kill is sent, its id may be reused by a stranger's group: never again.
    let gone = false;
    const stop = () => {
      if (!gone) killGroup(child);
    };
    const disarm = armExitTrap(stop);
    const released = new AbortController();
    const copied = this.#copy(child, spec, released.signal);
    if (spec.stdin) feed(child.stdin, spec.stdin, spec.cmd);
    const ended = child.status.then(({ code }) => {
      stop();
      gone = true;
      disarm();
      return code;
    });
    const exited = ended.then(async (code) => {
      await copied;
      return code;
    });
    return { pid: child.pid, ended, exited, stop, release: () => released.abort() };
  }

  /** Copies the child's output to ours (its stdout only unless discarded) until `released`. */
  #copy(child: Deno.ChildProcess, spec: ProcessSpec, released: AbortSignal): Promise<unknown> {
    const sinks = this.#sinks ??= { out: this.out.getWriter(), err: this.err.getWriter() };
    return Promise.all([
      spec.stdout === "discarded" ? undefined : copy(child.stdout, sinks.out, released),
      copy(child.stderr, sinks.err, released),
    ]);
  }

  runSync(spec: ProcessSpec): number {
    return command(spec, "null").outputSync().code;
  }
}

/**
 * One writer per output stream, held for the launcher's life: every process it starts writes
 * through them, so two at once (a run and the removal of its container) never contend for a
 * stream, as two `pipeTo`s would, the second finding it locked.
 */
type Sinks = {
  readonly out: WritableStreamDefaultWriter<Uint8Array>;
  readonly err: WritableStreamDefaultWriter<Uint8Array>;
};

/** Copies `from` into `to` until it ends, or until `released`, which cancels it. */
async function copy(
  from: ReadableStream<Uint8Array>,
  to: WritableStreamDefaultWriter<Uint8Array>,
  released: AbortSignal,
): Promise<void> {
  const reader = from.getReader();
  const cancel = () => {
    reader.cancel().catch((err) => {
      console.error(`warning: a sandbox's output could not be let go: ${(err as Error).message}`);
    });
  };
  released.addEventListener("abort", cancel, { once: true });
  try {
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      await to.write(read.value);
    }
  } finally {
    released.removeEventListener("abort", cancel);
  }
}

function command(spec: ProcessSpec, stdin: "piped" | "null"): Deno.Command {
  const host = spec.env === "host";
  return new Deno.Command(spec.cmd, {
    args: [...spec.args],
    clearEnv: !host,
    env: host ? undefined : { ...spec.env as Record<string, string> },
    cwd: spec.cwd,
    stdin,
    stdout: spec.stdout === "discarded" ? "null" : "piped",
    stderr: "piped",
    detached: GROUPS,
  });
}

/**
 * Kills the child's process group (POSIX), or the child alone (Windows). A group already gone is
 * not an error: `NotFound` once it is reaped, and on macOS `PermissionDenied` while its leader has
 * ended but is not yet reaped, the only member left; no live process of ours is spared by either.
 */
function killGroup(child: Deno.ChildProcess): void {
  try {
    if (GROUPS) Deno.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return;
    if (err instanceof Deno.errors.PermissionDenied && Deno.build.os === "darwin") return;
    throw err;
  }
}

/** Writes `bytes` to the child's input and closes it; a child that ended first is reported. */
function feed(stdin: WritableStream<Uint8Array>, bytes: Uint8Array, cmd: string): void {
  const writer = stdin.getWriter();
  writer.write(bytes).then(() => writer.close()).catch((err) => {
    console.error(`warning: ${cmd} did not read its input: ${(err as Error).message}`);
  });
}
