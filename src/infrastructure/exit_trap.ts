/**
 * Runs a synchronous cleanup when the process ends: on a normal end or `Deno.exit` (the `unload`
 * event), and on the signals a terminal or a supervisor sends, after which it exits with the
 * shell's `128 + n` code. Returns the disarm. Signal listeners do not keep the process alive.
 *
 * The cleanups armed at once run newest first, each once: what was set up last is torn down
 * first. A run's processes are stopped before the volume they write to is detached, and that
 * volume before the host removes the scratch folder it is mounted on. A cleanup that throws is
 * reported, and the others still run.
 */

const SIGNALS: ReadonlyArray<readonly [Deno.Signal, number]> = Deno.build.os === "windows"
  ? [["SIGINT", 130], ["SIGBREAK", 149]]
  : [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]];

/** The cleanups armed now, oldest first. */
const armed: (() => void)[] = [];

/** The listeners' removal while any cleanup is armed; `null` when none is. */
let listening: (() => void) | null = null;

export function armExitTrap(cleanup: () => void): () => void {
  const entry = () => cleanup();
  armed.push(entry);
  listening ??= listen();
  return () => {
    const at = armed.indexOf(entry);
    if (at >= 0) armed.splice(at, 1);
    if (armed.length === 0) stopListening();
  };
}

/** Runs every armed cleanup, newest first, and disarms them all. */
function runAll(): void {
  for (const cleanup of armed.splice(0).reverse()) {
    try {
      cleanup();
    } catch (err) {
      console.error(`warning: a cleanup at exit failed: ${(err as Error).message}`);
    }
  }
  stopListening();
}

function listen(): () => void {
  globalThis.addEventListener("unload", runAll);
  const handlers = SIGNALS.map(([signal, code]) => {
    const handler = () => {
      runAll();
      Deno.exit(code);
    };
    Deno.addSignalListener(signal, handler);
    return [signal, handler] as const;
  });
  return () => {
    globalThis.removeEventListener("unload", runAll);
    for (const [signal, handler] of handlers) Deno.removeSignalListener(signal, handler);
  };
}

function stopListening(): void {
  listening?.();
  listening = null;
}
