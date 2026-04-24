import { assertEquals } from "@std/assert";
import { GitHubBacklogSyncTarget } from "../../src/infrastructure/github_backlog_sync.ts";
import type { SyncConfig } from "../../src/domain/sync_config.ts";
import type { BacklogTask } from "../../src/domain/backlog/task.ts";
import type {
  SubprocessOptions,
  SubprocessResult,
  SubprocessRunner,
} from "../../src/application/ports.ts";

function fakeRunner(
  handler: (cmd: string, args: string[]) => SubprocessResult,
): SubprocessRunner & { calls: Array<{ cmd: string; args: string[] }> } {
  const calls: Array<{ cmd: string; args: string[]; opts?: SubprocessOptions }> = [];
  return {
    calls,
    run: (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return Promise.resolve(handler(cmd, args));
    },
  };
}

const CONFIG: SyncConfig = {
  version: 1,
  sync: {
    provider: "github",
    repo: "kevin/specflow",
    project: null,
    label_prefix: "backlog/",
  },
};

function makeTask(overrides: Partial<BacklogTask> = {}): BacklogTask {
  return {
    id: "001",
    title: "Hello",
    category: "devex",
    priority: "high",
    complexity: 5,
    status: "todo",
    dependsOn: [],
    spec: null,
    tags: [],
    created: "2026-04-24",
    body: "Body content",
    ...overrides,
  };
}

Deno.test("listExisting maps gh output to Map<id, issue>", async () => {
  const runner = fakeRunner(() => ({
    code: 0,
    stdout: JSON.stringify([
      { number: 42, state: "OPEN", labels: [{ name: "backlog/001" }] },
      { number: 17, state: "CLOSED", labels: [{ name: "backlog/002" }, { name: "devex" }] },
      { number: 99, state: "OPEN", labels: [{ name: "other" }] },
    ]),
    stderr: "",
  }));
  const target = new GitHubBacklogSyncTarget(runner);
  const existing = await target.listExisting(CONFIG);
  assertEquals(existing.size, 2);
  assertEquals(existing.get("001")?.number, 42);
  assertEquals(existing.get("001")?.state, "open");
  assertEquals(existing.get("002")?.state, "closed");
});

Deno.test("apply(create) builds labels from frontmatter", async () => {
  const runner = fakeRunner((_cmd, args) => {
    if (args[0] === "issue" && args[1] === "create") {
      return { code: 0, stdout: "https://github.com/kevin/specflow/issues/42", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
  const target = new GitHubBacklogSyncTarget(runner);
  const res = await target.apply({ kind: "create", task: makeTask() }, CONFIG);
  assertEquals(res.ok, true);
  if (res.ok) assertEquals(res.issueNumber, 42);

  const createCall = runner.calls.find(
    (c) => c.args[0] === "issue" && c.args[1] === "create",
  )!;
  const labels: string[] = [];
  for (let i = 0; i < createCall.args.length - 1; i++) {
    if (createCall.args[i] === "--label") labels.push(createCall.args[i + 1]);
  }
  assertEquals(labels.includes("backlog/001"), true);
  assertEquals(labels.includes("priority/high"), true);
  assertEquals(labels.includes("category/devex"), true);
});

Deno.test("apply(close) calls gh issue close with correct reason", async () => {
  const runner = fakeRunner(() => ({ code: 0, stdout: "", stderr: "" }));
  const target = new GitHubBacklogSyncTarget(runner);
  await target.apply(
    { kind: "close", task: makeTask({ status: "done" }), issueNumber: 42, reason: "completed" },
    CONFIG,
  );
  const call = runner.calls[0];
  assertEquals(call.args.slice(0, 3), ["issue", "close", "42"]);
  assertEquals(call.args.includes("completed"), true);
});

Deno.test("apply(update) edits issue title and refreshes body/labels", async () => {
  const runner = fakeRunner(() => ({ code: 0, stdout: "", stderr: "" }));
  const target = new GitHubBacklogSyncTarget(runner);
  const res = await target.apply(
    { kind: "update", task: makeTask({ priority: "critical" }), issueNumber: 42 },
    CONFIG,
  );
  assertEquals(res.ok, true);
  const call = runner.calls.find((c) => c.args[0] === "issue" && c.args[1] === "edit")!;
  assertEquals(call.args.slice(0, 3), ["issue", "edit", "42"]);
});

Deno.test("apply(skip) returns ok:true without any gh call", async () => {
  const runner = fakeRunner(() => ({ code: 0, stdout: "", stderr: "" }));
  const target = new GitHubBacklogSyncTarget(runner);
  const res = await target.apply(
    { kind: "skip", task: makeTask(), reason: "invalid frontmatter" },
    CONFIG,
  );
  assertEquals(res.ok, true);
  assertEquals(runner.calls.length, 0);
});
