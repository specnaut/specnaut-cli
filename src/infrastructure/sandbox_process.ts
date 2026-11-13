import { groupStop, LEADS_A_GROUP } from "./sandbox_process_group.ts";

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
  /** `captured` for a helper whose failure is read, not shown: `Started.stderr` holds it. */
  readonly stderr?: "copied" | "captured";
};

export type Started = {
  /** Its process id, which on POSIX is also its process group's. */
  readonly pid: number;
  /** The exit code, as soon as the process has ended; its process group is killed then. */
  readonly ended: Promise<number>;
  /** The exit code, once the process has ended and its output is copied, or let go by `release`. */
  readonly exited: Promise<number>;
  /** What it wrote to its standard error, by `exited`, when its spec `captured` it; else empty. */
  readonly stderr: Promise<string>;
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

export class DenoProcessLauncher implements ProcessLauncher {
  #sinks?: Sinks;

  constructor(
    readonly out: WritableStream<Uint8Array> = Deno.stdout.writable,
    readonly err: WritableStream<Uint8Array> = Deno.stderr.writable,
  ) {}

  start(spec: ProcessSpec): Started {
    const child = command(spec, spec.stdin ? "piped" : "null").spawn();
    const { stop, retire } = groupStop(child);
    const released = new AbortController();
    const output = this.#copy(child, spec, released.signal);
    if (spec.stdin) feed(child.stdin, spec.stdin, spec.cmd);
    const ended = child.status.then(({ code }) => {
      retire();
      return code;
    });
    const exited = ended.then(async (code) => {
      await output.copied;
      return code;
    });
    const release = () => released.abort();
    return { pid: child.pid, ended, exited, stderr: output.stderr, stop, release };
  }

  /**
   * Copies the child's output to ours (its stdout unless discarded, its stderr unless captured)
   * until `released`; what it captured is `stderr`.
   */
  #copy(child: Deno.ChildProcess, spec: ProcessSpec, released: AbortSignal) {
    const sinks = this.#sinks ??= { out: this.out.getWriter(), err: this.err.getWriter() };
    const captured = spec.stderr === "captured" ? textOf(child.stderr, released) : null;
    const copied = Promise.all([
      spec.stdout === "discarded" ? undefined : copy(child.stdout, sinks.out, released),
      captured ?? copy(child.stderr, sinks.err, released),
    ]);
    return { copied, stderr: captured ?? Promise.resolve("") };
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

/** What `from` holds, as text, once it ends or is `released`. */
async function textOf(from: ReadableStream<Uint8Array>, released: AbortSignal): Promise<string> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const sink = new WritableStream<Uint8Array<ArrayBuffer>>({ write: (c) => void chunks.push(c) });
  await copy(from, sink.getWriter(), released);
  return await new Blob(chunks).text();
}

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
    detached: LEADS_A_GROUP,
  });
}

/** Writes `bytes` to the child's input and closes it; a child that ended first is reported. */
function feed(stdin: WritableStream<Uint8Array>, bytes: Uint8Array, cmd: string): void {
  const writer = stdin.getWriter();
  writer.write(bytes).then(() => writer.close()).catch((err) => {
    console.error(`warning: ${cmd} did not read its input: ${(err as Error).message}`);
  });
}
