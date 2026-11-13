// `run-gate.sh` echoes each command of the tier through gate_ascii: a control character written
// in gates.yml reaches the report as `?`, never the terminal.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { gateProject, lf, runGate } from "./run_gate_fixture.ts";

const ESC = "\u001b";

Deno.test("run-gate (bash): a command's control characters are echoed as ?, and it still runs", async () => {
  const gates = `fast_gate:\n  - echo ran # ${ESC}[2J\n  - false # ${ESC}]0;title\u0007\n`;
  const r = await runGate("bash", await gateProject(gates), ["fast"]);
  assertEquals(r.code, 1, r.stderr);
  assertStringIncludes(lf(r.stdout), "  [1/2] echo ran # ?[2J\nran\n");
  assertStringIncludes(lf(r.stdout), "  [2/2] false # ?]0;title?\n");
  assertStringIncludes(
    r.stderr,
    "x the fast gate failed at command 2/2 (exit 1): false # ?]0;title?",
  );
  assert(
    !r.stdout.includes(ESC) && !r.stderr.includes(ESC),
    "a control character reached the output",
  );
});
