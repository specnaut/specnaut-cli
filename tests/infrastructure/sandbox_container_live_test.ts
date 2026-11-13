import { assertEquals } from "@std/assert";
import { encodeHex } from "@std/encoding/hex";
import { fromFileUrl } from "@std/path";
import {
  DenoProcessLauncher,
  type ProcessLauncher,
} from "../../src/infrastructure/sandbox_process.ts";
import { ContainerRunner } from "../../src/infrastructure/sandbox_runners.ts";
import { DRAIN_GRACE_SECONDS } from "../../src/infrastructure/sandbox_wall_clock.ts";
import {
  capture,
  ENGINE,
  live,
  LIVE_IMAGE,
  NO_CONTAINER,
  withLayout,
} from "./sandbox_live_fixture.ts";

/**
 * A container on a real engine outlives the client that started it: these show it is removed
 * however that client ends, early or with the CLI killed. Skipped, saying why, without an engine
 * or without an image named in SPECNAUT_LIVE_IMAGE.
 */

const engine = ENGINE ?? "docker";
/** A command that prints a line every 0.2 s for 30 s: past any limit below. */
const TICKS = [
  "/bin/sh",
  "-c",
  "i=0; while [ $i -lt 150 ]; do echo tick; sleep 0.2; i=$((i+1)); done",
];

const fresh = () => `specnaut-sandbox-live-${encodeHex(crypto.getRandomValues(new Uint8Array(6)))}`;

/** `value`, after `ms` milliseconds. */
function later<T>(ms: number, value: T): Promise<T> {
  return new Promise((ok) => setTimeout(() => ok(value), ms));
}

/** Whether container `name` exists, running or not. */
function present(name: string): boolean {
  const ps = new Deno.Command(engine, {
    args: ["ps", "--all", "--quiet", "--filter", `name=${name}`],
    stderr: "null",
  }).outputSync();
  return new TextDecoder().decode(ps.stdout).trim() !== "";
}

/** Waits for container `name` to appear, failing past `ms`. */
async function appeared(name: string, ms = 15_000): Promise<void> {
  for (const until = Date.now() + ms; !present(name); await later(100, 0)) {
    if (Date.now() > until) throw new Error(`container ${name} never started`);
  }
}

/** Removes what a failed test left behind. */
function sweep(name: string): void {
  new Deno.Command(engine, { args: ["rm", "--force", name], stdout: "null", stderr: "null" })
    .outputSync();
}

Deno.test({
  name: live("container live: a client that ends early leaves no container behind", NO_CONTAINER),
  ignore: NO_CONTAINER !== null,
  fn: () =>
    withLayout("container", async ({ policy }) => {
      const name = fresh();
      const real = new DenoProcessLauncher(capture().stream, capture().stream);
      // The client of the run is killed once its container is up; the container is not.
      const killing: ProcessLauncher = {
        ...real,
        runSync: (spec) => real.runSync(spec),
        start: (spec) => {
          const started = real.start(spec);
          if (spec.args[0] === "run") {
            appeared(name).then(() => Deno.kill(started.pid, "SIGKILL"), (err) => {
              console.error(`the client was never killed: ${(err as Error).message}`);
            });
          }
          return started;
        },
      };
      const timed = { ...policy, limits: { ...policy.limits, wallClockSeconds: 60 } };
      try {
        const outcome = await new ContainerRunner(engine, LIVE_IMAGE, killing, [], () => name)
          .run(timed, TICKS);
        assertEquals(outcome, { kind: "exited", code: 137 });
        assertEquals(present(name), false, "the container outlived its client");
      } finally {
        sweep(name);
      }
    }),
});

Deno.test({
  name: live(
    "container live: with the CLI killed by SIGKILL, the container goes with its client",
    NO_CONTAINER,
  ),
  ignore: NO_CONTAINER !== null,
  fn: async () => {
    const name = fresh();
    const base = await Deno.realPath(await Deno.makeTempDir({ prefix: "specnaut-killed-" }));
    const child = fromFileUrl(new URL("./sandbox_killed_runner.ts", import.meta.url));
    const flags = ["--allow-read", "--allow-write", "--allow-run", "--allow-env"];
    const cli = new Deno.Command(Deno.execPath(), {
      args: ["run", ...flags, child, base, "container", engine, LIVE_IMAGE, name],
      stdin: "null",
      stdout: "piped",
      stderr: "null",
    }).spawn();
    const output = cli.stdout.getReader();
    try {
      // Killed once the command's output flows: its client then writes to a closed pipe.
      await output.read();
      cli.kill("SIGKILL");
      const killed = Date.now();
      await cli.status;
      // Its client ends on that pipe, the watchdog sees its group gone and removes the container,
      // long before the run's 60 s wall clock, past which it would have been removed anyway.
      const limit = killed + (DRAIN_GRACE_SECONDS + 2) * 1000;
      while (present(name) && Date.now() < limit) await later(200, 0);
      assertEquals(present(name), false, "the container outlived its client");
    } finally {
      await output.cancel();
      sweep(name);
      await Deno.remove(base, { recursive: true });
    }
  },
});
