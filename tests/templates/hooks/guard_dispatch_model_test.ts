import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  type Harness,
  makeRepo,
  payload,
  pool,
  type Run,
  runHook,
  sandbox,
} from "./hook_sandbox.ts";

/**
 * US2 / FR-003 — a Specnaut agent runs on the tier its definition declares.
 * A dispatch that overrides it (Claude `tool_input.model`; Codex
 * `tool_input.model` or `reasoning_effort`, § 11 Measured) is refused on both
 * harnesses; a non-Specnaut agent is never touched; the session's own
 * top-level `model` (present in every Codex payload) is never read.
 */

type Case = [
  label: string,
  harness: Harness,
  tool: string,
  input: Record<string, unknown>,
  want: 0 | 2,
];

const CASES: readonly Case[] = [
  // Claude Agent / Task
  ["Specnaut agent + model", "claude", "Agent", {
    subagent_type: "architect-expert",
    model: "haiku",
  }, 2],
  [
    "Task tool, same rule",
    "claude",
    "Task",
    { subagent_type: "security-expert", model: "sonnet" },
    2,
  ],
  ["plugin-namespaced name", "claude", "Agent", {
    subagent_type: "specnaut-cockpit:code-reviewer",
    model: "haiku",
  }, 2],
  ["model: inherit is still an override", "claude", "Agent", {
    subagent_type: "developer",
    model: "inherit",
  }, 2],
  ["Specnaut agent, no model", "claude", "Agent", { subagent_type: "architect-expert" }, 0],
  ["Specnaut agent, model null", "claude", "Agent", {
    subagent_type: "architect-expert",
    model: null,
  }, 0],
  ["Specnaut agent, model empty", "claude", "Agent", {
    subagent_type: "architect-expert",
    model: "",
  }, 0],
  [
    "non-Specnaut agent + model",
    "claude",
    "Agent",
    { subagent_type: "my-helper", model: "haiku" },
    0,
  ],
  ["default agent + model", "claude", "Agent", { model: "haiku" }, 0],
  ["the user's own agent file in .claude/agents is not ours", "claude", "Agent", {
    subagent_type: "house-reviewer",
    model: "haiku",
  }, 0],
  ["a name that is not a token + model", "claude", "Agent", {
    subagent_type: "../architect-expert",
    model: "haiku",
  }, 2],
  ["a name with a space + model", "claude", "Agent", {
    subagent_type: "architect expert",
    model: "haiku",
  }, 2],
  ["a name that is not a token, no model", "claude", "Agent", { subagent_type: "../x" }, 0],
  // Codex spawn_agent
  ["Specnaut agent, nulls", "codex", "spawn_agent", {
    agent_type: "architect-expert",
    model: null,
    reasoning_effort: null,
  }, 0],
  ["Specnaut agent + model", "codex", "spawn_agent", {
    agent_type: "architect-expert",
    model: "gpt-5.4-mini",
  }, 2],
  ["Specnaut agent + reasoning_effort", "codex", "spawn_agent", {
    agent_type: "test-reviewer",
    reasoning_effort: "low",
  }, 2],
  ["Specnaut agent + model object", "codex", "spawn_agent", {
    agent_type: "developer",
    model: { id: "x" },
  }, 2],
  ["non-Specnaut agent + model", "codex", "spawn_agent", {
    agent_type: "worker",
    model: "gpt-5.4-mini",
  }, 0],
  ["the user's own agent file in .codex/agents is not ours", "codex", "spawn_agent", {
    agent_type: "house-tester",
    reasoning_effort: "high",
  }, 0],
  ["default agent + model", "codex", "spawn_agent", { message: "go", model: "gpt-5.4-mini" }, 0],
];

const FIXTURE: Record<Harness, string> = {
  claude: "pre_tool_use_agent",
  codex: "pre_tool_use_spawn_agent",
};

Deno.test("guard-dispatch-model: Claude Agent/Task and Codex spawn_agent", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { mode: "auto" });
    await Deno.mkdir(join(repo, ".claude", "agents"), { recursive: true });
    await Deno.writeTextFile(
      join(repo, ".claude", "agents", "house-reviewer.md"),
      "---\nname: house-reviewer\n---\n",
    );
    await Deno.mkdir(join(repo, ".codex", "agents"), { recursive: true });
    await Deno.writeTextFile(
      join(repo, ".codex", "agents", "house-tester.toml"),
      'name = "house-tester"\n',
    );
    const runs: Run[] = await pool(
      CASES,
      async ([, harness, tool, input]) =>
        runHook(
          sb,
          "guard-dispatch-model.sh",
          harness,
          await payload(harness, FIXTURE[harness], {
            cwd: repo,
            tool_name: tool,
            tool_input: input,
          }),
        ),
    );
    const wrong = CASES.flatMap(([label, harness, , , want], i) =>
      runs[i].code === want
        ? []
        : [`${harness} ${label}: want ${want}, got ${runs[i].code} ${runs[i].stderr}`]
    );
    assertEquals(wrong, [], wrong.join("\n"));
  } finally {
    await sb.cleanup();
  }
});

Deno.test("guard-dispatch-model names the rule, and never reads the session's top-level model", async () => {
  const sb = await sandbox();
  try {
    const repo = await makeRepo(sb, { mode: "auto" });
    const deny = await runHook(
      sb,
      "guard-dispatch-model.sh",
      "claude",
      await payload("claude", "pre_tool_use_agent", {
        cwd: repo,
        tool_input: { subagent_type: "architect-expert", model: "haiku" },
      }),
    );
    assertEquals(deny.code, 2);
    assertStringIncludes(deny.stderr, "Specnaut agent");
    assertStringIncludes(deny.stderr, "declares");
    for (const harness of ["claude", "codex"] as const) {
      const p = await payload(harness, FIXTURE[harness], {
        cwd: repo,
        model: "some-session-model",
      });
      const r = await runHook(sb, "guard-dispatch-model.sh", harness, p);
      assertEquals(
        r.code,
        0,
        `${harness}: a top-level model is the session's, not an override: ${r.stderr}`,
      );
    }
    const other = await runHook(
      sb,
      "guard-dispatch-model.sh",
      "claude",
      await payload("claude", "pre_tool_use_bash", { cwd: repo }),
    );
    assertEquals(other.code, 2, "a tool this guard does not read is an unknown shape");
  } finally {
    await sb.cleanup();
  }
});
