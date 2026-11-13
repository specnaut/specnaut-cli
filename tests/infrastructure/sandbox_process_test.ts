import { assertEquals, assertRejects } from "@std/assert";
import { DenoProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { untilWallClock } from "../../src/infrastructure/sandbox_wall_clock.ts";
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

/** Runs `fn` with every `Deno.kill` recorded and handed to `kill` (the real one), then undone. */
async function recordingKills(
  fn: (kills: number[]) => Promise<void>,
  kill: typeof Deno.kill = Deno.kill,
): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(Deno, "kill")!;
  const kills: number[] = [];
  Object.defineProperty(Deno, "kill", {
    configurable: true,
    get: () => (pid: number, signal?: Deno.Signal) => {
      kills.push(pid);
      kill(pid, signal);
    },
  });
  try {
    await fn(kills);
  } finally {
    Object.defineProperty(Deno, "kill", original);
  }
}

Deno.test({
  name: "DenoProcessLauncher: once its process is reaped, stopping it signals nothing",
  ignore: !POSIX,
  fn: () =>
    recordingKills(async (kills) => {
      const launcher = new DenoProcessLauncher(capture().stream, capture().stream);
      const started = launcher.start({ cmd: "/bin/sh", args: ["-c", "exit 0"], env: {} });
      assertEquals(await started.exited, 0);
      // Its end kills the group alone: by then its pid is reaped, and may be a stranger's.
      assertEquals(kills, [-started.pid]);
      const before = kills.length;
      // Its id may belong to another process group by now: a signal could reach a stranger.
      started.stop();
      assertEquals(kills.slice(before), []);
    }),
});

Deno.test({
  name: "DenoProcessLauncher: a group kill that fails at its end still retires the group's id",
  ignore: !POSIX,
  fn: () =>
    recordingKills(async (kills) => {
      const launcher = new DenoProcessLauncher(capture().stream, capture().stream);
      const started = launcher.start({ cmd: "/bin/sh", args: ["-c", "exit 0"], env: {} });
      await assertRejects(() => started.exited, Error, "kill refused");
      started.stop();
      assertEquals(kills.length, 1);
    }, () => {
      throw new Error("kill refused");
    }),
});

/** The real `Deno.kill`, for a stand-in that hands some kills on to it. */
const REAL_KILL = Deno.kill;

/** A kill that finds no process group (`NotFound`), as when the leader has left its own. */
const groupGone: typeof Deno.kill = (pid, signal) => {
  if (pid < 0) throw new Deno.errors.NotFound("no such process group");
  REAL_KILL(pid, signal);
};

Deno.test({
  name: "DenoProcessLauncher: at the deadline a leader whose group is gone is killed by its pid",
  ignore: !POSIX,
  fn: () =>
    // The launcher's process leads a session of its own, which POSIX forbids from changing its
    // group: the group's kill finding nothing is stood in for, the leader itself is real.
    recordingKills(async (kills) => {
      const launcher = new DenoProcessLauncher(capture().stream, capture().stream);
      const started = launcher.start({ cmd: "/bin/sleep", args: [MARKER], env: {} });
      try {
        const run = untilWallClock(started, 0.2, undefined, 0.2);
        const outcome = await Promise.race([run, later(3000, "outlived the deadline")]);
        assertEquals(outcome, { kind: "timed_out", seconds: 0.2 });
        assertEquals(kills.includes(started.pid), true, "the leader was never killed by its pid");
      } finally {
        killNamed(`/bin/sleep ${MARKER}`);
      }
    }, groupGone),
});

Deno.test({
  name: "DenoProcessLauncher: an error output that is captured is read, never copied to ours",
  ignore: !POSIX,
  fn: async () => {
    const err = capture();
    const launcher = new DenoProcessLauncher(capture().stream, err.stream);
    const script = "echo gone >&2; exit 1";
    const spec = { cmd: "/bin/sh", args: ["-c", script], env: {} };
    const captured = launcher.start({ ...spec, stderr: "captured" });
    assertEquals(await captured.exited, 1);
    assertEquals([await captured.stderr, err.text()], ["gone\n", ""]);
    const copied = launcher.start(spec);
    assertEquals(await copied.exited, 1);
    assertEquals([await copied.stderr, err.text()], ["", "gone\n"]);
  },
});

Deno.test({
  name: "DenoProcessLauncher: a standard output that is captured is read, never copied to ours",
  ignore: !POSIX,
  fn: async () => {
    const out = capture();
    const launcher = new DenoProcessLauncher(out.stream, capture().stream);
    const spec = { cmd: "/bin/sh", args: ["-c", "echo kept"], env: {} };
    const captured = launcher.start({ ...spec, stdout: "captured" });
    assertEquals(await captured.exited, 0);
    assertEquals([await captured.stdout, out.text()], ["kept\n", ""]);
    const copied = launcher.start(spec);
    assertEquals(await copied.exited, 0);
    assertEquals([await copied.stdout, out.text()], ["", "kept\n"]);
  },
});
