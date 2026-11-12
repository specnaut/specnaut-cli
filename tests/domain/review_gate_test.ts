import { assert, assertEquals } from "@std/assert";
import { PASS_TTL_MS, passHolds, startsReview, toolCallOf } from "../../src/domain/review_gate.ts";

Deno.test("a command line starts a review wherever its words `review start` stand", () => {
  for (
    const line of [
      "specnaut review start 12",
      "cd /x && specnaut review start origin/topic",
      "/usr/local/bin/specnaut  review\tstart 7",
      "out=$(specnaut review start 3)",
      "specnaut review start",
    ]
  ) assert(startsReview(line), line);
  for (
    const line of [
      "specnaut review end 12",
      "specnaut reviewstart",
      "specnaut pre-review start",
      "specnaut review started",
      "specnaut review start-x",
      "git log",
    ]
  ) assert(!startsReview(line), line);
});

Deno.test("a pass holds for its time, never past it, and never from a clock that ran back", () => {
  const granted = 1_000_000;
  assert(passHolds(granted, granted));
  assert(passHolds(granted, granted + PASS_TTL_MS));
  assert(!passHolds(granted, granted + PASS_TTL_MS + 1));
  assert(!passHolds(granted, granted - 1));
  assert(!passHolds(NaN, granted));
});

Deno.test("a hook's input gives its session id and shell command, each only as a string", () => {
  assertEquals(
    toolCallOf({ session_id: "s-1", tool_name: "Bash", tool_input: { command: "ls" } }),
    { sessionId: "s-1", command: "ls" },
  );
  assertEquals(toolCallOf({ session_id: 7, tool_input: { command: ["ls"] } }), {
    sessionId: null,
    command: null,
  });
  for (const payload of [undefined, null, "x", [], { tool_input: "ls" }]) {
    assertEquals(toolCallOf(payload), { sessionId: null, command: null });
  }
});
