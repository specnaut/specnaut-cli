import { assertEquals, assertThrows } from "@std/assert";
import {
  assertValidComplexity,
  assertValidPriority,
  assertValidStatus,
  type BacklogTask,
} from "../../../src/domain/backlog/task.ts";

Deno.test("assertValidPriority accepts all 4 levels", () => {
  assertValidPriority("critical");
  assertValidPriority("high");
  assertValidPriority("medium");
  assertValidPriority("low");
});

Deno.test("assertValidPriority rejects unknown values", () => {
  assertThrows(() => assertValidPriority("urgent"), Error, "priority");
});

Deno.test("assertValidStatus accepts all 5 states", () => {
  assertValidStatus("todo");
  assertValidStatus("in_progress");
  assertValidStatus("done");
  assertValidStatus("deferred");
  assertValidStatus("blocked");
});

Deno.test("assertValidStatus rejects unknown values", () => {
  assertThrows(() => assertValidStatus("wip"), Error, "status");
});

Deno.test("assertValidComplexity accepts all Fibonacci values", () => {
  for (const n of [1, 2, 3, 5, 8, 13, 21]) assertValidComplexity(n);
});

Deno.test("assertValidComplexity rejects non-Fibonacci", () => {
  for (const n of [0, 4, 6, 7, 10, 34]) {
    assertThrows(() => assertValidComplexity(n), Error, "Fibonacci");
  }
});

Deno.test("BacklogTask is a plain readonly object", () => {
  const task: BacklogTask = {
    id: "001",
    title: "first",
    category: "devex",
    priority: "high",
    complexity: 5,
    status: "todo",
    dependsOn: [],
    spec: null,
    tags: [],
    created: "2026-04-24",
    body: "",
  };
  assertEquals(task.id, "001");
});
