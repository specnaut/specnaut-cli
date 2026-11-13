import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DenoProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { watchdogSpec } from "../../src/infrastructure/sandbox_watchdog.ts";
import { capture, exists } from "./sandbox_live_fixture.ts";

/**
 * The host watchdog, run for real against a real process group: past its deadline it kills the
 * group, then runs the removal; once the group is gone it runs the removal too, and leaves.
 */

const POSIX = Deno.build.os !== "windows";

/** `value`, after `ms` milliseconds. */
function later<T>(ms: number, value: T): Promise<T> {
  return new Promise((ok) => setTimeout(() => ok(value), ms));
}

async function withMarker(fn: (marker: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "specnaut-watchdog-" });
  try {
    await fn(join(dir, "removed"));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const launcher = () => new DenoProcessLauncher(capture().stream, capture().stream);

Deno.test({
  name: "watchdog: past its deadline it kills the run's process group and runs the removal",
  ignore: !POSIX,
  fn: () =>
    withMarker(async (marker) => {
      const l = launcher();
      const run = l.start({ cmd: "/bin/sh", args: ["-c", "sleep 30.613; :"], env: {} });
      const dog = l.start(watchdogSpec(run.pid, 1, ["/usr/bin/touch", marker]));
      assertEquals(await Promise.race([dog.exited, later(5000, "still watching")]), 0);
      assertEquals(await Promise.race([run.ended, later(2000, "still running")]), 137);
      assertEquals(exists(marker), true);
    }),
});

Deno.test({
  name: "watchdog: past its deadline it kills the run's process group before the removal",
  ignore: !POSIX,
  fn: () =>
    withMarker(async (marker) => {
      const l = launcher();
      const run = l.start({ cmd: "/bin/sh", args: ["-c", "sleep 30.614; :"], env: {} });
      const slow = ["/bin/sh", "-c", 'sleep 1; touch "$0"', marker];
      const dog = l.start(watchdogSpec(run.pid, 1, slow));
      assertEquals(await Promise.race([run.ended, later(5000, "still running")]), 137);
      assertEquals(exists(marker), false, "the removal ran before the group was killed");
      assertEquals(await Promise.race([dog.exited, later(4000, "still watching")]), 0);
      assertEquals(exists(marker), true);
    }),
});

Deno.test({
  name: "watchdog: once the run's group is gone it runs the removal and leaves",
  ignore: !POSIX,
  fn: () =>
    withMarker(async (marker) => {
      const l = launcher();
      const run = l.start({ cmd: "/bin/sh", args: ["-c", "sleep 0.2"], env: {} });
      const dog = l.start(watchdogSpec(run.pid, 30, ["/usr/bin/touch", marker]));
      assertEquals(await run.exited, 0);
      assertEquals(await Promise.race([dog.exited, later(4000, "still watching")]), 0);
      assertEquals(exists(marker), true);
    }),
});

Deno.test("watchdogSpec: its own process, quiet, in our environment, the deadline rounded up", () => {
  assertEquals(watchdogSpec(4321, 61.2).env, "host");
  const env = { PATH: "/usr/bin:/bin" };
  const spec = watchdogSpec(4321, 61.2, ["podman", "rm", "--force", "x"], env);
  assertEquals([spec.cmd, spec.env, spec.stdout], ["/bin/sh", env, "discarded"]);
  assertEquals(spec.args.slice(2), [
    "specnaut-watchdog",
    "62",
    "4321",
    "podman",
    "rm",
    "--force",
    "x",
  ]);
});
