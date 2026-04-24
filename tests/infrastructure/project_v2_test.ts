import { assertEquals } from "@std/assert";
import { GitHubBacklogSyncTarget } from "../../src/infrastructure/github_backlog_sync.ts";
import type {
  SubprocessOptions,
  SubprocessResult,
  SubprocessRunner,
} from "../../src/application/ports.ts";
import type { SyncConfig } from "../../src/domain/sync_config.ts";
import type { BacklogTask } from "../../src/domain/backlog/task.ts";

const CONFIG_WITH_PROJECT: SyncConfig = {
  version: 1,
  sync: {
    provider: "github",
    repo: "kevin/specflow",
    project: {
      number: 3,
      owner: "kevin",
      fieldMap: { status: "Status", priority: "Priority", complexity: "Complexity" },
    },
    label_prefix: "backlog/",
  },
};

const TASK: BacklogTask = {
  id: "001",
  title: "hi",
  category: "devex",
  priority: "high",
  complexity: 5,
  status: "in_progress",
  dependsOn: [],
  spec: null,
  tags: [],
  created: "2026-04-24",
  body: "body",
};

function scriptedRunner(
  responses: Array<{ match: RegExp; result: SubprocessResult }>,
): SubprocessRunner & { calls: Array<{ cmd: string; args: string[] }> } {
  const calls: Array<{ cmd: string; args: string[]; opts?: SubprocessOptions }> = [];
  return {
    calls,
    run: (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      const joined = args.join(" ");
      const match = responses.find((r) => r.match.test(joined));
      if (!match) {
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      }
      return Promise.resolve(match.result);
    },
  };
}

Deno.test("apply(create) with project attaches issue and sets 3 fields", async () => {
  const runner = scriptedRunner([
    {
      match: /issue create/,
      result: { code: 0, stdout: "https://github.com/kevin/specflow/issues/42", stderr: "" },
    },
    {
      match: /user\(login.*projectV2|organization\(login.*projectV2/,
      result: {
        code: 0,
        stdout: JSON.stringify({
          data: {
            user: { projectV2: { id: "PVT_proj3" } },
            organization: null,
          },
        }),
        stderr: "",
      },
    },
    {
      match: /repository\(owner.*issue\(number/,
      result: {
        code: 0,
        stdout: JSON.stringify({
          data: { repository: { issue: { id: "I_kwA42" } } },
        }),
        stderr: "",
      },
    },
    {
      match: /ProjectV2SingleSelectField|fields\(first/,
      result: {
        code: 0,
        stdout: JSON.stringify({
          data: {
            node: {
              fields: {
                nodes: [
                  {
                    id: "F_status",
                    name: "Status",
                    dataType: "SINGLE_SELECT",
                    options: [
                      { id: "O_todo", name: "Todo" },
                      { id: "O_progress", name: "In progress" },
                      { id: "O_done", name: "Done" },
                    ],
                  },
                  { id: "F_priority", name: "Priority", dataType: "NUMBER" },
                  { id: "F_complexity", name: "Complexity", dataType: "NUMBER" },
                ],
              },
            },
          },
        }),
        stderr: "",
      },
    },
    {
      match: /addProjectV2ItemById/,
      result: {
        code: 0,
        stdout: JSON.stringify({
          data: { addProjectV2ItemById: { item: { id: "PVT_item42" } } },
        }),
        stderr: "",
      },
    },
    {
      match: /updateProjectV2ItemFieldValue/,
      result: { code: 0, stdout: JSON.stringify({ data: {} }), stderr: "" },
    },
  ]);
  const target = new GitHubBacklogSyncTarget(runner);
  const res = await target.apply({ kind: "create", task: TASK }, CONFIG_WITH_PROJECT);
  assertEquals(res.ok, true);

  const fieldUpdates = runner.calls.filter((c) =>
    c.args.some((a) => a.includes("updateProjectV2ItemFieldValue"))
  );
  assertEquals(fieldUpdates.length, 3);
});

Deno.test("apply(update) with project re-attaches (idempotent server-side) and refreshes fields", async () => {
  const runner = scriptedRunner([
    { match: /issue edit/, result: { code: 0, stdout: "", stderr: "" } },
    {
      match: /user\(login.*projectV2|organization\(login.*projectV2/,
      result: {
        code: 0,
        stdout: JSON.stringify({
          data: {
            user: { projectV2: { id: "PVT_proj3" } },
            organization: null,
          },
        }),
        stderr: "",
      },
    },
    {
      match: /repository\(owner.*issue\(number/,
      result: {
        code: 0,
        stdout: JSON.stringify({
          data: { repository: { issue: { id: "I_kwA42" } } },
        }),
        stderr: "",
      },
    },
    {
      match: /fields\(first/,
      result: {
        code: 0,
        stdout: JSON.stringify({
          data: {
            node: {
              fields: {
                nodes: [
                  {
                    id: "F_status",
                    name: "Status",
                    dataType: "SINGLE_SELECT",
                    options: [{ id: "O_progress", name: "In progress" }],
                  },
                  { id: "F_priority", name: "Priority", dataType: "NUMBER" },
                  { id: "F_complexity", name: "Complexity", dataType: "NUMBER" },
                ],
              },
            },
          },
        }),
        stderr: "",
      },
    },
    {
      match: /addProjectV2ItemById/,
      result: {
        code: 0,
        stdout: JSON.stringify({
          data: { addProjectV2ItemById: { item: { id: "PVT_item42" } } },
        }),
        stderr: "",
      },
    },
    {
      match: /updateProjectV2ItemFieldValue/,
      result: { code: 0, stdout: "{}", stderr: "" },
    },
  ]);
  const target = new GitHubBacklogSyncTarget(runner);
  const res = await target.apply(
    { kind: "update", task: TASK, issueNumber: 42 },
    CONFIG_WITH_PROJECT,
  );
  assertEquals(res.ok, true);
});

Deno.test("apply(close) does not touch Project V2 fields", async () => {
  const runner = scriptedRunner([
    { match: /issue close/, result: { code: 0, stdout: "", stderr: "" } },
  ]);
  const target = new GitHubBacklogSyncTarget(runner);
  await target.apply(
    { kind: "close", task: TASK, issueNumber: 42, reason: "completed" },
    CONFIG_WITH_PROJECT,
  );
  const graphqlCalls = runner.calls.filter((c) => c.args.includes("graphql"));
  assertEquals(graphqlCalls.length, 0);
});
