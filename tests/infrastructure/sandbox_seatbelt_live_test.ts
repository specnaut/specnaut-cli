import { assert, assertEquals } from "@std/assert";
import type { DenoProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { SeatbeltRunner } from "../../src/infrastructure/sandbox_runners.ts";
import { fromFileUrl, join } from "@std/path";
import { DRAIN_GRACE_SECONDS } from "../../src/infrastructure/sandbox_wall_clock.ts";
import {
  detaching,
  killNamed,
  live,
  mountedOn,
  NO_PERL,
  probed,
  processesNamed,
  runIn,
  withLayout,
} from "./sandbox_live_fixture.ts";

/** `sandbox-exec` on a real macOS host, through the real launcher; skipped elsewhere, saying so. */

const MISSING = probed.sandboxExec ? null : "macOS with sandbox-exec";

const mac = (l: DenoProcessLauncher) => new SeatbeltRunner(l);

Deno.test({
  name: live("seatbelt live: the command's exit code is the run's", MISSING),
  ignore: MISSING !== null,
  fn: () =>
    withLayout("seatbelt", async ({ policy }) => {
      const { outcome } = await runIn(mac, policy, ["/bin/sh", "-c", "exit 7"]);
      assertEquals(outcome, { kind: "exited", code: 7 });
    }),
});

Deno.test({
  name: live("seatbelt live: the tree is read, never written; home and temp are written", MISSING),
  ignore: MISSING !== null,
  fn: () =>
    withLayout("seatbelt", async ({ policy, tree }) => {
      const script = "cat hello.txt; touch planted 2>/dev/null && echo TREE-WRITTEN; " +
        'echo h > "$HOME/f" && echo t > "$TMPDIR/f" && cat "$HOME/f" "$TMPDIR/f"';
      const { outcome, out } = await runIn(mac, policy, ["/bin/sh", "-c", script]);
      assertEquals(outcome, { kind: "exited", code: 0 });
      assertEquals(out, "from the tree\nh\nt\n");
      assertEquals([...Deno.readDirSync(tree)].map((e) => e.name), ["hello.txt"]);
    }),
});

Deno.test({
  name: live("seatbelt live: the environment is exactly the policy's", MISSING),
  ignore: MISSING !== null,
  fn: () =>
    withLayout("seatbelt", async ({ policy }) => {
      const { out } = await runIn(mac, policy, ["/usr/bin/env"]);
      const expected = Object.entries(policy.env).map(([k, v]) => `${k}=${v}`).sort();
      assertEquals(out.trim().split("\n").sort(), expected);
    }),
});

Deno.test({
  name: live("seatbelt live: the user's home stays out of reach", MISSING),
  ignore: MISSING !== null,
  fn: () =>
    withLayout("seatbelt", async ({ policy, home }) => {
      const { outcome } = await runIn(mac, policy, ["/bin/ls", home]);
      assert(outcome.kind === "exited" && outcome.code !== 0, JSON.stringify(outcome));
    }),
});

Deno.test({
  name: live("seatbelt live: what the command leaves running is stopped with it", MISSING),
  ignore: MISSING !== null,
  fn: () =>
    withLayout("seatbelt", async ({ policy }) => {
      const marker = "sleep 31.731";
      const started = Date.now();
      const { outcome } = await runIn(mac, policy, ["/bin/sh", "-c", `(${marker} &); exit 0`]);
      assertEquals(outcome, { kind: "exited", code: 0 });
      // Killed, not waited for: the sleep holds the output pipe, so waiting would take its 31 s.
      assert(Date.now() - started < 10_000, `the run took ${Date.now() - started} ms`);
      assertEquals(processesNamed(marker), []);
    }),
});

Deno.test({
  name: live("seatbelt live: the wall clock stops the run and its children", MISSING),
  ignore: MISSING !== null,
  fn: () =>
    withLayout("seatbelt", async ({ policy }) => {
      const marker = "sleep 32.417";
      const timed = { ...policy, limits: { ...policy.limits, wallClockSeconds: 0.5 } };
      const { outcome } = await runIn(mac, timed, ["/bin/sh", "-c", `${marker} & ${marker}`]);
      assertEquals(outcome, { kind: "timed_out", seconds: 0.5 });
      assertEquals(processesNamed(marker), []);
    }),
});

/** `value`, after `ms` milliseconds. */
function later<T>(ms: number, value: T): Promise<T> {
  return new Promise((ok) => setTimeout(() => ok(value), ms));
}

const DETACHED = MISSING ?? NO_PERL;

Deno.test({
  name: live(
    "seatbelt live: a process that left the group delays the run by the grace only",
    DETACHED,
  ),
  ignore: DETACHED !== null,
  fn: () =>
    withLayout("seatbelt", async ({ policy }) => {
      const marker = "34.219";
      const timed = { ...policy, limits: { ...policy.limits, wallClockSeconds: 2 } };
      const started = Date.now();
      try {
        const { outcome, out } = await runIn(mac, timed, ["/bin/sh", "-c", detaching(marker)]);
        const took = Date.now() - started;
        assertEquals(outcome, { kind: "exited", code: 0 });
        assertEquals(out, "before\n");
        assert(took < (2 + DRAIN_GRACE_SECONDS + 1) * 1000, `the run took ${took} ms`);
        // Let go, not stopped: what STOP_LIMIT says of this backend.
        assertEquals(processesNamed(`sleep ${marker}`).length, 1);
      } finally {
        killNamed(`sleep ${marker}`);
      }
    }),
});

Deno.test({
  name: live(
    "seatbelt live: a run whose launcher is killed with SIGKILL still ends on time",
    MISSING,
  ),
  ignore: MISSING !== null,
  fn: async () => {
    const marker = "/bin/sleep 35.137";
    const base = await Deno.realPath(await Deno.makeTempDir({ prefix: "specnaut-killed-" }));
    const child = fromFileUrl(new URL("./sandbox_killed_runner.ts", import.meta.url));
    const flags = ["--allow-read", "--allow-write", "--allow-run", "--allow-env"];
    const cli = new Deno.Command(Deno.execPath(), {
      args: ["run", ...flags, child, base, "seatbelt", marker.split(" ")[1]],
      stdin: "null",
      stdout: "null",
      stderr: "null",
    }).spawn();
    try {
      for (let i = 0; i < 100 && processesNamed(marker).length === 0; i++) await later(100, 0);
      const seen = Date.now();
      assertEquals(processesNamed(marker).length, 1, "the sandboxed command never started");
      cli.kill("SIGKILL");
      await cli.status;
      const limit = seen + (1 + DRAIN_GRACE_SECONDS + 2) * 1000;
      while (processesNamed(marker).length > 0 && Date.now() < limit) await later(200, 0);
      assertEquals(processesNamed(marker), [], "the sandboxed command outlived its wall clock");
      // The watchdog then ends the scratch volume no exit trap of the killed launcher could.
      const scratch = join(base, "scratch");
      for (let i = 0; i < 50 && mountedOn(scratch); i++) await later(200, 0);
      assertEquals(mountedOn(scratch), false, "the scratch volume outlived its launcher");
    } finally {
      killNamed(marker);
      killNamed("/bin/sh -c exec </dev/null");
      await Deno.remove(base, { recursive: true });
    }
  },
});
