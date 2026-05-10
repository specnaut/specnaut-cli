import { assertEquals, assertThrows } from "@std/assert";
import { parsePromoteArgs } from "../../.claude/skills/gh-issues/scripts/promote.ts";
import { parseRejectArgs } from "../../.claude/skills/gh-issues/scripts/reject.ts";

Deno.test("parsePromoteArgs defaults to P3/M", () => {
  const a = parsePromoteArgs(["42"]);
  assertEquals(a.num, 42);
  assertEquals(a.priority, "P3");
  assertEquals(a.size, "M");
});

Deno.test("parsePromoteArgs --priority overrides default", () => {
  const a = parsePromoteArgs(["42", "--priority", "P1"]);
  assertEquals(a.priority, "P1");
});

Deno.test("parsePromoteArgs --size overrides default", () => {
  const a = parsePromoteArgs(["42", "--size", "S"]);
  assertEquals(a.size, "S");
});

Deno.test("parsePromoteArgs accepts both flag overrides", () => {
  const a = parsePromoteArgs(["42", "--priority", "P0", "--size", "XL"]);
  assertEquals(a.priority, "P0");
  assertEquals(a.size, "XL");
});

Deno.test("parsePromoteArgs throws on invalid priority", () => {
  assertThrows(() => parsePromoteArgs(["42", "--priority", "P9"]));
});

Deno.test("parsePromoteArgs throws on invalid size", () => {
  assertThrows(() => parsePromoteArgs(["42", "--size", "XXL"]));
});

Deno.test("parsePromoteArgs throws on missing positional", () => {
  assertThrows(() => parsePromoteArgs(["--priority", "P1"]));
});

Deno.test("parsePromoteArgs throws on non-numeric positional", () => {
  assertThrows(() => parsePromoteArgs(["abc"]));
});

Deno.test("parseRejectArgs requires --reason with non-empty value", () => {
  const a = parseRejectArgs(["42", "--reason", "duplicate of #1"]);
  assertEquals(a.num, 42);
  assertEquals(a.reason, "duplicate of #1");
});

Deno.test("parseRejectArgs throws when --reason missing", () => {
  assertThrows(() => parseRejectArgs(["42"]));
});

Deno.test("parseRejectArgs throws when --reason is empty string", () => {
  assertThrows(() => parseRejectArgs(["42", "--reason", "   "]));
});

Deno.test("parseRejectArgs throws on missing positional", () => {
  assertThrows(() => parseRejectArgs(["--reason", "x"]));
});
