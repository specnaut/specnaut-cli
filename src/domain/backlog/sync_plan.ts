import type { BacklogTask } from "./task.ts";

export type ExistingIssue = {
  readonly id: string;
  readonly number: number;
  readonly state: "open" | "closed";
};

export type SyncAction =
  | { kind: "create"; task: BacklogTask }
  | { kind: "update"; task: BacklogTask; issueNumber: number }
  | {
    kind: "close";
    task: BacklogTask;
    issueNumber: number;
    reason: "completed" | "not_planned";
  }
  | { kind: "skip"; task: BacklogTask; reason: string };

export type SyncPlan = ReadonlyArray<SyncAction>;

export function computeSyncPlan(
  tasks: ReadonlyArray<BacklogTask>,
  existing: Map<string, ExistingIssue>,
): SyncPlan {
  const sorted = [...tasks].sort((a, b) => a.id.localeCompare(b.id));
  const plan: SyncAction[] = [];
  for (const task of sorted) {
    const ex = existing.get(task.id);
    if (task.status === "done") {
      if (ex) plan.push({ kind: "close", task, issueNumber: ex.number, reason: "completed" });
      else plan.push({ kind: "create", task });
      continue;
    }
    if (task.status === "deferred") {
      if (ex) plan.push({ kind: "close", task, issueNumber: ex.number, reason: "not_planned" });
      else plan.push({ kind: "create", task });
      continue;
    }
    if (ex) plan.push({ kind: "update", task, issueNumber: ex.number });
    else plan.push({ kind: "create", task });
  }
  return plan;
}
