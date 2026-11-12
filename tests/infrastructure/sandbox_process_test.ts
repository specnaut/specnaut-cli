import { assertEquals, assertRejects } from "@std/assert";
import {
  DenoProcessLauncher,
  type Started,
  untilWallClock,
} from "../../src/infrastructure/sandbox_process.ts";
import { capture } from "./sandbox_live_fixture.ts";

/**
 * How a sandbox's launcher process is waited on and stopped: the wall clock, the halt that stops
 * what the launcher alone cannot, and which of its output reaches ours.
 */

const POSIX = Deno.build.os !== "windows";

/** A process that never ends on its own; `stop` ends it with 137. */
function endless() {
  let stops = 0;
  let exit: (code: number) => void = () => {};
  const started: Started = {
    exited: new Promise<number>((ok) => (exit = ok)),
    stop: () => {
      stops++;
      exit(137);
    },
  };
  return { started, stops: () => stops };
}

Deno.test("untilWallClock: a halt that fails still stops the process, and the failure is raised", async () => {
  const { started, stops } = endless();
  const halt = () => Promise.reject(new Error("the engine is gone"));
  await assertRejects(() => untilWallClock(started, 0.01, halt), Error, "the engine is gone");
  assertEquals(stops(), 1);
});

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
