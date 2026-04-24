import type { ApplyResult, BacklogReader, BacklogSyncTarget } from "./ports.ts";
import { scanForSecrets } from "../domain/backlog/secret_scanner.ts";
import { computeSyncPlan, type SyncAction, type SyncPlan } from "../domain/backlog/sync_plan.ts";
import type { SyncConfig } from "../domain/sync_config.ts";

export type SyncBacklogInput = {
  projectDir: string;
  config: SyncConfig;
  dryRun: boolean;
  singleId: string | null;
  allowSecrets?: boolean;
};

export type SyncBacklogResult = {
  readonly plan: SyncPlan;
  readonly outcomes: ReadonlyArray<ApplyResult>;
  readonly failed: number;
};

export type SyncBacklogDeps = {
  reader: BacklogReader;
  target: BacklogSyncTarget;
};

export class SyncBacklogUseCase {
  constructor(private readonly deps: SyncBacklogDeps) {}

  async execute(input: SyncBacklogInput): Promise<SyncBacklogResult> {
    const { reader, target } = this.deps;
    const { projectDir, config, dryRun, singleId, allowSecrets = false } = input;

    let tasks = await reader.readAll(projectDir);
    if (singleId !== null) {
      const padded = singleId.padStart(3, "0");
      tasks = tasks.filter((t) => t.id === padded);
    }

    const existing = await target.listExisting(config);
    let plan = computeSyncPlan(tasks, existing);

    if (!allowSecrets) {
      plan = plan.map((action): SyncAction => {
        if (action.kind === "skip") return action;
        const hits = scanForSecrets(action.task.body);
        if (hits.length === 0) return action;
        const reason = `secret detected (${hits.map((h) => h.kind).join(", ")})`;
        return { kind: "skip", task: action.task, reason };
      });
    }

    if (dryRun) {
      return { plan, outcomes: [], failed: plan.filter((a) => a.kind === "skip").length };
    }

    const outcomes: ApplyResult[] = [];
    let failed = 0;
    for (const action of plan) {
      if (action.kind === "skip") {
        outcomes.push({
          ok: false,
          error: action.reason,
          action: "skip",
          taskId: action.task.id,
        });
        failed += 1;
        continue;
      }
      const outcome = await target.apply(action, config);
      outcomes.push(outcome);
      if (!outcome.ok) failed += 1;
    }

    return { plan, outcomes, failed };
  }
}
