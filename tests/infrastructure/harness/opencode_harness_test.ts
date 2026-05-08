import { assertEquals, assertStringIncludes } from "@std/assert";
import { OpenCodeHarness } from "../../../src/infrastructure/harness/opencode_harness.ts";
import type { CoreBundle } from "../../../src/domain/core_bundle.ts";

const harness = new OpenCodeHarness();

function commandEntry(name: string, body = "Body content"): CoreBundle[number] {
  return {
    category: "command",
    name,
    suffix: null,
    content:
      `---\ndescription: ${name} command\nargument-hint: <foo>\nallowed-tools: Read\n---\n${body}`,
    executable: false,
  };
}

function agentEntry(name: string, tools: string | null, body = "Agent body"): CoreBundle[number] {
  const fm = tools === null
    ? `name: ${name}\ndescription: ${name} agent\nmodel: sonnet`
    : `name: ${name}\ndescription: ${name} agent\nmodel: sonnet\ntools: ${tools}`;
  return {
    category: "agent",
    name,
    suffix: null,
    content: `---\n${fm}\n---\n${body}`,
    executable: false,
  };
}

function skillEntry(name: string): CoreBundle[number] {
  return {
    category: "skill",
    name,
    suffix: null,
    content: `---\nname: ${name}\ndescription: ${name} skill\n---\n\nSkill body`,
    executable: false,
  };
}

Deno.test("command emits to .opencode/commands/specflow.<name>.md", () => {
  const bundle = harness.mapBundle([commandEntry("specify")], { backlogBackend: "local" });
  const dest = ".opencode/commands/specflow-specify.md";
  assertEquals(Object.keys(bundle), [dest]);
  assertStringIncludes(bundle[dest].content, "description: specify command");
  assertEquals(bundle[dest].content.includes("argument-hint"), false);
  assertEquals(bundle[dest].content.includes("allowed-tools"), false);
  assertStringIncludes(bundle[dest].content, "Body content");
});

Deno.test("backlog-cmd emits to .opencode/commands/backlog.md", () => {
  const entry: CoreBundle[number] = {
    category: "backlog-cmd",
    name: "backlog",
    suffix: null,
    content: `---\ndescription: Backlog\n---\nBody`,
    executable: false,
  };
  const bundle = harness.mapBundle([entry], { backlogBackend: "local" });
  assertEquals(Object.keys(bundle), [".opencode/commands/backlog.md"]);
});

Deno.test("agent emits to .opencode/agents/specflow-<name>.md with mode: subagent", () => {
  const bundle = harness.mapBundle([
    agentEntry("developer", "Read, Write, Edit, Grep, Glob, Bash"),
  ], { backlogBackend: "local" });
  const dest = ".opencode/agents/specflow-developer.md";
  assertEquals(Object.keys(bundle), [dest]);
  assertStringIncludes(bundle[dest].content, "description: developer agent");
  assertStringIncludes(bundle[dest].content, "mode: subagent");
  assertStringIncludes(bundle[dest].content, "permission:");
  assertEquals(bundle[dest].content.includes("model: sonnet"), false);
});

Deno.test("agent translates Read+Write+Edit+Bash to permission block", () => {
  const bundle = harness.mapBundle([agentEntry("dev", "Read, Write, Edit, Bash")], {
    backlogBackend: "local",
  });
  const content = bundle[".opencode/agents/specflow-dev.md"].content;
  assertStringIncludes(content, "read: allow");
  assertStringIncludes(content, "write: allow");
  assertStringIncludes(content, "edit: allow");
  assertStringIncludes(content, "bash:");
  assertStringIncludes(content, '"*": ask');
});

Deno.test("agent de-dups Edit+MultiEdit into single edit permission", () => {
  const bundle = harness.mapBundle([agentEntry("dev", "Edit, MultiEdit")], {
    backlogBackend: "local",
  });
  const content = bundle[".opencode/agents/specflow-dev.md"].content;
  assertEquals(content.match(/edit: allow/g)?.length, 1);
});

Deno.test("agent omits Grep/Glob/Task/TodoWrite/NotebookEdit and unknowns", () => {
  const bundle = harness.mapBundle([
    agentEntry("dev", "Grep, Glob, Task, TodoWrite, NotebookEdit, Mystery"),
  ], { backlogBackend: "local" });
  const content = bundle[".opencode/agents/specflow-dev.md"].content;
  assertEquals(content.includes("permission:"), false);
});

Deno.test("agent strips Bash(git log *) parenthesized variants to Bash", () => {
  const bundle = harness.mapBundle([agentEntry("po", "Read, Bash(git log *), Bash(git diff *)")], {
    backlogBackend: "local",
  });
  const content = bundle[".opencode/agents/specflow-po.md"].content;
  assertStringIncludes(content, "read: allow");
  assertStringIncludes(content, "bash:");
  // De-duped: only one bash block
  assertEquals(content.match(/bash:/g)?.length, 1);
});

Deno.test("agent strips Agent(...) entries (subagent dispatch is native)", () => {
  const bundle = harness.mapBundle([
    agentEntry("wf", "Read, Bash, Agent(code-reviewer, security-auditor)"),
  ], { backlogBackend: "local" });
  const content = bundle[".opencode/agents/specflow-wf.md"].content;
  assertEquals(content.includes("agent:"), false);
});

Deno.test("agent with no tools field emits no permission block", () => {
  const bundle = harness.mapBundle([agentEntry("dev", null)], { backlogBackend: "local" });
  const content = bundle[".opencode/agents/specflow-dev.md"].content;
  assertEquals(content.includes("permission:"), false);
});

Deno.test("skill emits to .opencode/skills/specflow-<name>/SKILL.md with name+description", () => {
  const bundle = harness.mapBundle([skillEntry("auto-chain")], { backlogBackend: "local" });
  const dest = ".opencode/skills/specflow-auto-chain/SKILL.md";
  assertEquals(Object.keys(bundle), [dest]);
  assertStringIncludes(bundle[dest].content, "name: auto-chain");
  assertStringIncludes(bundle[dest].content, "description: auto-chain skill");
});

Deno.test("spec-root and project-root pass through unchanged", () => {
  const specRoot: CoreBundle[number] = {
    category: "spec-root",
    name: "specify",
    suffix: "memory/constitution.md",
    content: "raw constitution",
    executable: false,
  };
  const projectRoot: CoreBundle[number] = {
    category: "project-root",
    name: "root",
    suffix: "AGENTS.md",
    content: "raw AGENTS",
    executable: false,
  };
  const bundle = harness.mapBundle([specRoot, projectRoot], { backlogBackend: "local" });
  assertEquals(bundle[".specflow/memory/constitution.md"].content, "raw constitution");
  assertEquals(bundle["AGENTS.md"].content, "raw AGENTS");
});
