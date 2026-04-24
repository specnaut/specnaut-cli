export type Priority = "critical" | "high" | "medium" | "low";
export type Status = "todo" | "in_progress" | "done" | "deferred" | "blocked";
export type Complexity = 1 | 2 | 3 | 5 | 8 | 13 | 21;

export type BacklogTask = {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly priority: Priority;
  readonly complexity: Complexity;
  readonly status: Status;
  readonly dependsOn: ReadonlyArray<string>;
  readonly spec: string | null;
  readonly tags: ReadonlyArray<string>;
  readonly created: string;
  readonly body: string;
};

const PRIORITIES: ReadonlySet<Priority> = new Set(["critical", "high", "medium", "low"]);
const STATUSES: ReadonlySet<Status> = new Set([
  "todo",
  "in_progress",
  "done",
  "deferred",
  "blocked",
]);
const FIBS: ReadonlySet<number> = new Set([1, 2, 3, 5, 8, 13, 21]);

export function assertValidPriority(value: unknown): asserts value is Priority {
  if (typeof value !== "string" || !PRIORITIES.has(value as Priority)) {
    throw new Error(`Invalid priority: ${String(value)}`);
  }
}

export function assertValidStatus(value: unknown): asserts value is Status {
  if (typeof value !== "string" || !STATUSES.has(value as Status)) {
    throw new Error(`Invalid status: ${String(value)}`);
  }
}

export function assertValidComplexity(value: unknown): asserts value is Complexity {
  if (typeof value !== "number" || !FIBS.has(value)) {
    throw new Error(`Invalid complexity (must be Fibonacci 1,2,3,5,8,13,21): ${String(value)}`);
  }
}
