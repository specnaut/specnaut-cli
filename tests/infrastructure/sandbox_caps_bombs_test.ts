import { assert, assertEquals, assertMatch } from "@std/assert";
import type { RunOutcome } from "../../src/application/sandbox_ports.ts";
import { DRAIN_GRACE_SECONDS } from "../../src/infrastructure/sandbox_wall_clock.ts";
import {
  BOMBS,
  type Cap,
  expectedVerdicts,
  HANG,
  START,
  STOP_BY,
  WALL,
} from "./sandbox_caps_bombs.ts";

/**
 * The verdict of each bomb on what a run printed: stopped only on a line the cap's refusal prints,
 * finished only when every unit ran to its end, and unexplained when a unit failed for a reason
 * the cap did not cause, however few units that left.
 */

const EXITED: RunOutcome = { kind: "exited", code: 0 };
const lines = (...l: string[]) => [START, ...l].join("\n") + "\n";
const verdict = (cap: Cap, out: string, outcome: RunOutcome = EXITED, ms = 1000) =>
  BOMBS[cap].verdict(outcome, out, ms);
const range = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i));

Deno.test("memory bomb: killed units are the cap; a unit failing otherwise is not", () => {
  assertEquals(verdict("memoryBytes", lines(...range(4, (i) => `unit ${i} 0`))), "finished");
  const killed = lines("unit 0 137", "unit 1 137", "unit 2 0", "unit 3 137");
  assertEquals(verdict("memoryBytes", killed), "stopped");
  const noTool = lines("sh: tr: not found", "unit 0 3", "unit 1 3", "unit 2 3", "unit 3 3");
  assertMatch(verdict("memoryBytes", noTool), /^unexplained: /);
  assertMatch(verdict("memoryBytes", lines("unit 0 0", "unit 1 0")), /^unexplained: /);
});

Deno.test("fork bomb: a refused fork is the cap; fewer units for another reason is not", () => {
  assertEquals(verdict("processes", lines(...range(40, (i) => `up ${i}`))), "finished");
  for (
    const refused of ["sh: 1: Cannot fork", "sh: can't fork: Resource temporarily unavailable"]
  ) {
    assertEquals(verdict("processes", lines(...range(10, (i) => `up ${i}`), refused)), "stopped");
  }
  assertMatch(verdict("processes", lines(...range(10, (i) => `up ${i}`))), /^unexplained: /);
  // dash writes its prefix and its message apart, and another unit's line can come between them.
  const split = lines("up 0", "/bin/sh: 0: up 1", "up 2", "Cannot fork", "up 3");
  assertEquals(verdict("processes", split), "stopped");
  const splitOther = lines("up 0", "/bin/sh: 0: up 1", "sleep: not found");
  assertMatch(verdict("processes", splitOther), /^unexplained: /);
  const noSleep = lines(...range(40, (i) => `up ${i}`), "sh: sleep: not found");
  assertMatch(verdict("processes", noSleep), /^unexplained: /);
});

Deno.test("memory and fork bombs: a kill or refusal after more units ran than the cap holds is not its", () => {
  // Two 32 MiB units cannot both run to their end in 64 MiB: another kill took the others.
  const twoDone = lines("unit 0 0", "unit 1 137", "unit 2 0", "unit 3 137");
  assertMatch(verdict("memoryBytes", twoDone), /^unexplained: 2 units ran beside the cap/);
  // Sixteen units cannot be up under a cap of 16 that counts the shell: another limit refused it.
  const late = lines(...range(16, (i) => `up ${i}`), "sh: 1: Cannot fork");
  assertMatch(verdict("processes", late), /^unexplained: 16 units ran beside the cap/);
  const inCap = lines(...range(15, (i) => `up ${i}`), "sh: 1: Cannot fork");
  assertEquals(verdict("processes", inCap), "stopped");
});

Deno.test("memory and fork bombs: the units wait on a barrier, never on a timed sleep", () => {
  for (const cap of ["memoryBytes", "processes"] as const) {
    const { command } = BOMBS[cap];
    assert(!/\bsleep\b/.test(command), command);
    assert(command.includes("mkfifo go && exec 3<>go"), command);
    assert(command.includes("read -r g <&3"), command);
  }
});

Deno.test("scratch fill: a full scratch is the cap; a write refused otherwise is not", () => {
  assertEquals(verdict("scratchBytes", lines(...range(4, (i) => `wrote ${i}`))), "finished");
  const full = lines("wrote 0", "wrote 1", "head: write error: No space left on device");
  assertEquals(verdict("scratchBytes", full), "stopped");
  const busybox = lines("wrote 0", "wrote 1", "head: standard output: I/O error");
  assertEquals(verdict("scratchBytes", busybox), "stopped");
  assertMatch(verdict("scratchBytes", lines("head: /dev/zero: I/O error")), /^unexplained: /);
  const denied = lines("sh: can't create /tmp/f0: Permission denied");
  assertMatch(verdict("scratchBytes", denied), /^unexplained: /);
});

Deno.test("wall clock sleeps: stopped only by the wall clock, and well before they would end", () => {
  const timedOut: RunOutcome = { kind: "timed_out", seconds: WALL };
  assertEquals(verdict("wallClockSeconds", lines(), timedOut, (WALL + 1) * 1000), "stopped");
  // An engine that is slow to start, stop and remove the run on a loaded host is still in time.
  const loaded = (WALL + DRAIN_GRACE_SECONDS + 20) * 1000;
  assertEquals(verdict("wallClockSeconds", lines(), timedOut, loaded), "stopped");
  assert(HANG - STOP_BY >= 20, `a hang of ${HANG} s ends too close to ${STOP_BY} s`);
  assertMatch(verdict("wallClockSeconds", lines(), timedOut, STOP_BY * 1000), /^unexplained: /);
  // A run reported out of time before its wall clock could run out was not stopped by it.
  const early = (WALL - 1) * 1000;
  assertMatch(verdict("wallClockSeconds", lines(), timedOut, early), /^unexplained: /);
  assertEquals(verdict("wallClockSeconds", lines(), timedOut, WALL * 1000), "stopped");
  assertEquals(verdict("wallClockSeconds", lines()), "finished");
  assertMatch(verdict("wallClockSeconds", lines(), { kind: "exited", code: 1 }), /^unexplained: /);
  assertMatch(verdict("wallClockSeconds", lines("sh: setsid: oops")), /^unexplained: /);
});

Deno.test("wall clock sleeps: the case is named after the two sleeps it runs", () => {
  const { what, command } = BOMBS.wallClockSeconds;
  // One sleep is left in the background (in a session of its own where `setsid` exists), and the
  // shell's own sleep runs past the wall clock beside it.
  assert(command.includes(`sleep ${HANG}.5 &`) && command.endsWith(`; sleep ${HANG}.5`), command);
  assertEquals(
    what,
    `a sleep past the wall clock, beside a background one (${HANG}.5 s each, wall clock ${WALL} s)`,
  );
});

Deno.test("live verdicts: the memory case depends on the host where paged-out memory is not bound", () => {
  assertEquals(expectedVerdicts("memoryBytes", []), ["stopped"]);
  assertEquals(expectedVerdicts("memoryBytes", ["memorySwap"]), ["stopped", "finished"]);
  assertEquals(expectedVerdicts("memoryBytes", ["memoryBytes", "memorySwap"]), ["finished"]);
  assertEquals(expectedVerdicts("processes", ["memorySwap"]), ["stopped"]);
  assertEquals(expectedVerdicts("processes", ["processes"]), ["finished"]);
});
