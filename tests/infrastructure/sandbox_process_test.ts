import { assertEquals } from "@std/assert";
import { DenoProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { capture, detaching, killNamed, live, NO_PERL } from "./sandbox_live_fixture.ts";

/**
 * How a sandbox's launcher process is started and stopped: which of its output reaches ours, and
 * how an output still held open by a process that left its group is let go.
 */

const POSIX = Deno.build.os !== "windows";
const MARKER = "30.271";

/** `value`, after `ms` milliseconds. */
function later<T>(ms: number, value: T): Promise<T> {
  return new Promise((ok) => setTimeout(() => ok(value), ms));
}

Deno.test({
  name: "DenoProcessLauncher: a process whose output is discarded writes nothing to ours",
  ignore: !POSIX,
  fn: async () => {
    const out = capture();
    const err = capture();
    const launcher = new DenoProcessLauncher(out.stream, err.stream);
    const script = "echo to-stdout; echo to-stderr >&2";
    const spec = { cmd: "/bin/sh", args: ["-c", script], env: {} };
    assertEquals(await launcher.start({ ...spec, stdout: "discarded" }).exited, 0);
    assertEquals([out.text(), err.text()], ["", "to-stderr\n"]);
    assertEquals(await launcher.start(spec).exited, 0);
    assertEquals(out.text(), "to-stdout\n");
  },
});

Deno.test({
  name: live(
    "DenoProcessLauncher: output held by a process that left the group is let go",
    NO_PERL,
  ),
  ignore: NO_PERL !== null,
  fn: async () => {
    const out = capture();
    const launcher = new DenoProcessLauncher(out.stream, capture().stream);
    const started = launcher.start({ cmd: "/bin/sh", args: ["-c", detaching(MARKER)], env: {} });
    try {
      assertEquals(await started.ended, 0);
      const waiting = await Promise.race([started.exited, later(500, "still copying")]);
      assertEquals(waiting, "still copying");
      started.release();
      assertEquals(await Promise.race([started.exited, later(2000, "never let go")]), 0);
      assertEquals(out.text(), "before\n");
    } finally {
      killNamed(`sleep ${MARKER}`);
    }
  },
});

Deno.test({
  name: "DenoProcessLauncher: stopping a process that has ended but is not yet reaped is no error",
  ignore: !POSIX,
  fn: async () => {
    const launcher = new DenoProcessLauncher(capture().stream, capture().stream);
    const started = launcher.start({ cmd: "/bin/sh", args: ["-c", "exit 0"], env: {} });
    // Blocking the event loop keeps the ended process from being reaped while it is stopped.
    for (const until = Date.now() + 300; Date.now() < until;) { /* wait */ }
    started.stop();
    assertEquals(await started.exited, 0);
  },
});
