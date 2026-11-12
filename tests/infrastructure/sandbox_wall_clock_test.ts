import { assertEquals, assertRejects } from "@std/assert";
import type { Started } from "../../src/infrastructure/sandbox_process.ts";
import { untilWallClock } from "../../src/infrastructure/sandbox_wall_clock.ts";

/**
 * The wall clock around a started process: its exit code, or a stop once the clock runs out (with
 * the halt that stops what the launcher alone cannot), then a drain of its output that is bounded
 * whatever still holds the pipes.
 */

/**
 * A process that ends with `code`, or never when `null` until stopped (137). Its output is copied
 * once it ends, unless `held`: then a process outside its group holds the pipes until `release`.
 */
function fakeProcess(code: number | null, held = false) {
  const seen = { stops: 0, releases: 0 };
  let end: (code: number) => void = () => {};
  let let_go: () => void = () => {};
  const ended = new Promise<number>((ok) => (end = ok));
  const drained = new Promise<void>((ok) => (let_go = ok));
  ended.then(() => held || let_go());
  if (code !== null) end(code);
  const started: Started = {
    pid: 4242,
    ended,
    exited: Promise.all([ended, drained]).then(([c]) => c),
    stop: () => {
      seen.stops++;
      end(137);
    },
    release: () => {
      seen.releases++;
      let_go();
    },
  };
  return { started, seen };
}

Deno.test("untilWallClock: a command that ends in time gives its code, its output fully copied", async () => {
  const { started, seen } = fakeProcess(3);
  assertEquals(await untilWallClock(started, 60), { kind: "exited", code: 3 });
  assertEquals(seen, { stops: 0, releases: 0 });
});

Deno.test("untilWallClock: past the clock the halt runs, then the stop", async () => {
  const { started, seen } = fakeProcess(null);
  const order: string[] = [];
  const halt = () => {
    order.push(`halt, ${seen.stops} stops`);
    return Promise.resolve();
  };
  assertEquals(await untilWallClock(started, 0.01, halt), { kind: "timed_out", seconds: 0.01 });
  assertEquals([order, seen.stops], [["halt, 0 stops"], 1]);
});

Deno.test("untilWallClock: a halt that fails still stops the process, and the failure is raised", async () => {
  const { started, seen } = fakeProcess(null);
  const halt = () => Promise.reject(new Error("the engine is gone"));
  await assertRejects(() => untilWallClock(started, 0.01, halt), Error, "the engine is gone");
  assertEquals(seen.stops, 1);
});

Deno.test("untilWallClock: output held open past the grace is let go, and the code still given", async () => {
  const { started, seen } = fakeProcess(0, true);
  const begun = Date.now();
  assertEquals(await untilWallClock(started, 60, undefined, 0.2), { kind: "exited", code: 0 });
  assertEquals(seen, { stops: 0, releases: 1 });
  const took = Date.now() - begun;
  assertEquals(took >= 150 && took < 2000, true, `${took} ms`);
});

Deno.test("untilWallClock: a timed-out run whose output is held still ends by the clock plus the grace", async () => {
  const { started, seen } = fakeProcess(null, true);
  const begun = Date.now();
  const outcome = await untilWallClock(started, 0.1, undefined, 0.2);
  assertEquals(outcome, { kind: "timed_out", seconds: 0.1 });
  assertEquals(seen, { stops: 1, releases: 1 });
  assertEquals(Date.now() - begun < 2000, true);
});
