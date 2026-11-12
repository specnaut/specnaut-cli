/**
 * Runs a synchronous cleanup when the process ends: on a normal end or `Deno.exit` (the `unload`
 * event), and on the signals a terminal or a supervisor sends, after which it exits with the
 * shell's `128 + n` code. Returns the disarm. Signal listeners do not keep the process alive.
 */

const SIGNALS: ReadonlyArray<readonly [Deno.Signal, number]> = Deno.build.os === "windows"
  ? [["SIGINT", 130], ["SIGBREAK", 149]]
  : [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]];

export function armExitTrap(cleanup: () => void): () => void {
  const onUnload = () => cleanup();
  globalThis.addEventListener("unload", onUnload);
  const handlers = SIGNALS.map(([signal, code]) => {
    const handler = () => {
      cleanup();
      Deno.exit(code);
    };
    Deno.addSignalListener(signal, handler);
    return [signal, handler] as const;
  });
  return () => {
    globalThis.removeEventListener("unload", onUnload);
    for (const [signal, handler] of handlers) Deno.removeSignalListener(signal, handler);
  };
}
