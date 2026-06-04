import { assertEquals } from "@std/assert";
import { parseArgs } from "../../src/cli/parser.ts";

Deno.test("gate status parses", () => {
  const i = parseArgs(["gate", "status"]);
  assertEquals(i.kind, "gate");
  if (i.kind === "gate") assertEquals(i.sub, "status");
});

Deno.test("gate raise captures type/title/payload/task/api-url", () => {
  const i = parseArgs([
    "gate",
    "raise",
    "--type",
    "decision",
    "--title",
    "Which auth?",
    "--payload",
    '{"question":"q","options":[{"id":"A","label":"x"}]}',
    "--task",
    "42",
    "--api-url",
    "https://dep.convex.site",
  ]);
  assertEquals(i.kind, "gate");
  if (i.kind === "gate") {
    assertEquals(i.sub, "raise");
    assertEquals(i.type, "decision");
    assertEquals(i.title, "Which auth?");
    assertEquals(i.payload, '{"question":"q","options":[{"id":"A","label":"x"}]}');
    assertEquals(i.task, 42);
    assertEquals(i.apiUrl, "https://dep.convex.site");
  }
});

Deno.test("gate cancel captures the positional id", () => {
  const i = parseArgs(["gate", "cancel", "gate_7Kf3Qx9"]);
  assertEquals(i.kind, "gate");
  if (i.kind === "gate") {
    assertEquals(i.sub, "cancel");
    assertEquals(i.id, "gate_7Kf3Qx9");
  }
});

Deno.test("a non-numeric --task is dropped to null", () => {
  const i = parseArgs(["gate", "raise", "--task", "abc"]);
  if (i.kind === "gate") assertEquals(i.task, null);
});

Deno.test("an unknown gate subcommand is rejected", () => {
  const i = parseArgs(["gate", "frobnicate"]);
  assertEquals(i.kind, "unknown");
});
