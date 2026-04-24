import { assert, assertEquals } from "@std/assert";
import { SyncBacklogUseCase } from "../../src/application/sync_backlog.ts";
import type { ApplyResult, BacklogReader, BacklogSyncTarget } from "../../src/application/ports.ts";
import type { BacklogTask } from "../../src/domain/backlog/task.ts";
import type { ExistingIssue, SyncAction } from "../../src/domain/backlog/sync_plan.ts";
import type { SyncConfig } from "../../src/domain/sync_config.ts";

const CONFIG: SyncConfig = {
  version: 1,
  sync: {
    provider: "github",
    repo: "k/s",
    project: null,
    label_prefix: "backlog/",
  },
};

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

function fakeReader(tasks: BacklogTask[]): BacklogReader {
  return {
    readAll: () => Promise.resolve(tasks),
    readOne: (_d, id) => Promise.resolve(tasks.find((t) => t.id === id.padStart(3, "0")) ?? null),
  };
}

function fakeTarget(
  existing: Map<string, ExistingIssue>,
  apply: (a: SyncAction) => ApplyResult,
): BacklogSyncTarget & { actions: SyncAction[] } {
  const actions: SyncAction[] = [];
  return {
    actions,
    listExisting: () => Promise.resolve(existing),
    apply: (a) => {
      actions.push(a);
      return Promise.resolve(apply(a));
    },
  };
}

Deno.test("SyncBacklogUseCase creates new issues in one run", async () => {
  const reader = fakeReader([task({ id: "001", status: "todo" })]);
  const target = fakeTarget(
    new Map(),
    (a) => ({ ok: true, issueNumber: 42, action: a.kind }),
  );
  const uc = new SyncBacklogUseCase({ reader, target });
  const result = await uc.execute({
    projectDir: "/proj",
    config: CONFIG,
    dryRun: false,
    singleId: null,
  });
  assertEquals(result.outcomes.length, 1);
  assertEquals(result.outcomes[0].action, "create");
  if (result.outcomes[0].ok) assertEquals(result.outcomes[0].issueNumber, 42);
  assertEquals(result.failed, 0);
});

Deno.test("SyncBacklogUseCase dry-run returns plan without applying", async () => {
  const reader = fakeReader([task({ id: "001", status: "todo" })]);
  let applyCalled = false;
  const target: BacklogSyncTarget = {
    listExisting: () => Promise.resolve(new Map()),
    apply: () => {
      applyCalled = true;
      return Promise.resolve({ ok: true, issueNumber: 1, action: "create" });
    },
  };
  const uc = new SyncBacklogUseCase({ reader, target });
  const result = await uc.execute({
    projectDir: "/p",
    config: CONFIG,
    dryRun: true,
    singleId: null,
  });
  assertEquals(applyCalled, false);
  assertEquals(result.plan.length, 1);
  assertEquals(result.plan[0].kind, "create");
});

Deno.test("SyncBacklogUseCase accumulates failures and continues", async () => {
  const reader = fakeReader([
    task({ id: "001", status: "todo" }),
    task({ id: "002", status: "todo" }),
  ]);
  const target = fakeTarget(new Map(), (a) => {
    if (a.kind === "create" && a.task.id === "001") {
      return { ok: false, error: "boom", action: "create", taskId: "001" };
    }
    return { ok: true, issueNumber: 99, action: a.kind };
  });
  const uc = new SyncBacklogUseCase({ reader, target });
  const result = await uc.execute({
    projectDir: "/p",
    config: CONFIG,
    dryRun: false,
    singleId: null,
  });
  assertEquals(result.outcomes.length, 2);
  assertEquals(result.failed, 1);
});

Deno.test("SyncBacklogUseCase filters to single id when provided", async () => {
  const reader = fakeReader([
    task({ id: "001", status: "todo" }),
    task({ id: "002", status: "todo" }),
  ]);
  const target = fakeTarget(
    new Map(),
    (a) => ({ ok: true, issueNumber: 1, action: a.kind }),
  );
  const uc = new SyncBacklogUseCase({ reader, target });
  const result = await uc.execute({
    projectDir: "/p",
    config: CONFIG,
    dryRun: false,
    singleId: "002",
  });
  assertEquals(result.outcomes.length, 1);
  assertEquals(result.plan[0].task.id, "002");
});

Deno.test("SyncBacklogUseCase skips tasks with detected secrets and marks failure", async () => {
  const taskWithSecret = task({
    id: "001",
    status: "todo",
    body: "key: ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  });
  const reader = fakeReader([taskWithSecret]);
  const target = fakeTarget(
    new Map(),
    (a) => ({ ok: true, issueNumber: 1, action: a.kind }),
  );
  const uc = new SyncBacklogUseCase({ reader, target });
  const result = await uc.execute({
    projectDir: "/p",
    config: CONFIG,
    dryRun: false,
    singleId: null,
    allowSecrets: false,
  });
  assertEquals(result.plan[0].kind, "skip");
  assertEquals(result.failed, 1);
  assert((target as { actions: SyncAction[] }).actions.every((a) => a.kind !== "create"));
});

Deno.test("SyncBacklogUseCase with allowSecrets=true still creates despite secret match", async () => {
  const reader = fakeReader([
    task({
      id: "001",
      status: "todo",
      body: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    }),
  ]);
  const target = fakeTarget(
    new Map(),
    (a) => ({ ok: true, issueNumber: 1, action: a.kind }),
  );
  const uc = new SyncBacklogUseCase({ reader, target });
  const result = await uc.execute({
    projectDir: "/p",
    config: CONFIG,
    dryRun: false,
    singleId: null,
    allowSecrets: true,
  });
  assertEquals(result.plan[0].kind, "create");
  assertEquals(result.failed, 0);
});
