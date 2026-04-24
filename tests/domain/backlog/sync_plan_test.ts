import { assertEquals } from "@std/assert";
import { computeSyncPlan, type ExistingIssue } from "../../../src/domain/backlog/sync_plan.ts";
import type { BacklogTask } from "../../../src/domain/backlog/task.ts";

function task(
  partial: Partial<BacklogTask> & { id: string; status: BacklogTask["status"] },
): BacklogTask {
  return {
    title: "t",
    category: "c",
    priority: "medium",
    complexity: 3,
    dependsOn: [],
    spec: null,
    tags: [],
    created: "2026-04-24",
    body: "",
    ...partial,
  };
}

Deno.test("computeSyncPlan emits create for new task without existing issue", () => {
  const plan = computeSyncPlan([task({ id: "001", status: "todo" })], new Map());
  assertEquals(plan.length, 1);
  assertEquals(plan[0].kind, "create");
});

Deno.test("computeSyncPlan emits update for open task with existing open issue", () => {
  const existing = new Map<string, ExistingIssue>([
    ["001", { id: "001", number: 42, state: "open" }],
  ]);
  const plan = computeSyncPlan([task({ id: "001", status: "in_progress" })], existing);
  assertEquals(plan.length, 1);
  assertEquals(plan[0].kind, "update");
  if (plan[0].kind === "update") assertEquals(plan[0].issueNumber, 42);
});

Deno.test("computeSyncPlan emits close-completed for done task", () => {
  const existing = new Map<string, ExistingIssue>([
    ["001", { id: "001", number: 42, state: "open" }],
  ]);
  const plan = computeSyncPlan([task({ id: "001", status: "done" })], existing);
  assertEquals(plan.length, 1);
  if (plan[0].kind === "close") {
    assertEquals(plan[0].reason, "completed");
    assertEquals(plan[0].issueNumber, 42);
  }
});

Deno.test("computeSyncPlan emits close-not-planned for deferred task", () => {
  const existing = new Map<string, ExistingIssue>([
    ["001", { id: "001", number: 42, state: "open" }],
  ]);
  const plan = computeSyncPlan([task({ id: "001", status: "deferred" })], existing);
  if (plan[0].kind === "close") assertEquals(plan[0].reason, "not_planned");
});

Deno.test("computeSyncPlan still emits close for done task when issue already closed", () => {
  const existing = new Map<string, ExistingIssue>([
    ["001", { id: "001", number: 42, state: "closed" }],
  ]);
  const plan = computeSyncPlan([task({ id: "001", status: "done" })], existing);
  assertEquals(plan[0].kind, "close");
});

Deno.test("computeSyncPlan emits update for a task with an existing closed issue that is now todo (reopen via edit)", () => {
  const existing = new Map<string, ExistingIssue>([
    ["001", { id: "001", number: 42, state: "closed" }],
  ]);
  const plan = computeSyncPlan([task({ id: "001", status: "todo" })], existing);
  assertEquals(plan[0].kind, "update");
});

Deno.test("computeSyncPlan handles multiple tasks in id order", () => {
  const tasks = [
    task({ id: "002", status: "todo" }),
    task({ id: "001", status: "done" }),
  ];
  const existing = new Map<string, ExistingIssue>([
    ["001", { id: "001", number: 10, state: "open" }],
  ]);
  const plan = computeSyncPlan(tasks, existing);
  assertEquals(plan.map((a) => a.kind), ["close", "create"]);
});
