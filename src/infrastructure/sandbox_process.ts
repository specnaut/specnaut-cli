import type { RunOutcome } from "../application/sandbox_ports.ts";
import { armExitTrap } from "./exit_trap.ts";

/**
 * How a sandbox's launcher process is started and stopped. The process gets no terminal: its
 * standard input is the bytes given (then closed) or nothing, and its output is copied to ours
 * through pipes, so no descriptor of our terminal reaches the sandbox. On POSIX it leads a process
 * group of its own, and stopping it kills the whole group: whatever the command left running in
 * the background goes too, when it ends, when the wall clock runs out, and when we are interrupted.
 */

export type ProcessSpec = {
  readonly cmd: string;
  readonly args: readonly string[];
  /** Its whole environment; `host` only for a container engine's client, which needs ours. */
  readonly env: Readonly<Record<string, string>> | "host";
  readonly cwd?: string;
  readonly stdin?: Uint8Array;
  /** `discarded` for a helper whose output must never pass for the command's own; `copied` else. */
  readonly stdout?: "copied" | "discarded";
};

export type Started = {
  /** The exit code, once the process has ended and its output is copied. */
  readonly exited: Promise<number>;
  /** Kills it and its process group; a process already gone is not an error. */
  stop(): void;
};

export interface ProcessLauncher {
  start(spec: ProcessSpec): Started;
  /** Runs `spec` to its end, synchronously: for the cleanup an interrupt runs. */
  runSync(spec: ProcessSpec): number;
}

/**
 * The command's outcome, or `timed_out` once `seconds` pass: then `halt` runs (what stops a run
 * the launcher alone cannot, such as a container), the process is stopped, and its end awaited.
 */
export async function untilWallClock(
  started: Started,
  seconds: number,
  halt: () => Promise<void> = () => Promise.resolve(),
): Promise<RunOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((ok) => (timer = setTimeout(() => ok("late"), seconds * 1000)));
  try {
    const first = await Promise.race([started.exited, late]);
    if (first !== "late") return { kind: "exited", code: first };
    try {
      await halt();
    } finally {
      started.stop();
    }
    await started.exited;
    return { kind: "timed_out", seconds };
  } finally {
    clearTimeout(timer);
  }
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
    const stop = () => killGroup(child);
    const disarm = armExitTrap(stop);
    const sinks = this.#sinks ??= { out: this.out.getWriter(), err: this.err.getWriter() };
    const copied = Promise.all([
      spec.stdout === "discarded" ? undefined : copy(child.stdout, sinks.out),
      copy(child.stderr, sinks.err),
    ]);
    if (spec.stdin) feed(child.stdin, spec.stdin, spec.cmd);
    const exited = child.status.then(async ({ code }) => {
      stop();
      await copied;
      disarm();
      return code;
    });
    return { exited, stop };
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

async function copy(
  from: ReadableStream<Uint8Array>,
  to: WritableStreamDefaultWriter<Uint8Array>,
): Promise<void> {
  for await (const chunk of from) await to.write(chunk);
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

/** Kills the child's process group (POSIX), or the child alone (Windows). */
function killGroup(child: Deno.ChildProcess): void {
  try {
    if (GROUPS) Deno.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
}

/** Writes `bytes` to the child's input and closes it; a child that ended first is reported. */
function feed(stdin: WritableStream<Uint8Array>, bytes: Uint8Array, cmd: string): void {
  const writer = stdin.getWriter();
  writer.write(bytes).then(() => writer.close()).catch((err) => {
    console.error(`warning: ${cmd} did not read its input: ${(err as Error).message}`);
  });
}
