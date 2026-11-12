import { assert, assertEquals } from "@std/assert";
import type { DenoProcessLauncher } from "../../src/infrastructure/sandbox_process.ts";
import { SeatbeltRunner } from "../../src/infrastructure/sandbox_runners.ts";
import { live, probed, processesNamed, runIn, withLayout } from "./sandbox_live_fixture.ts";

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
