import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { parse as parseYaml } from "@std/yaml";
import { CORE_BUNDLE } from "../../../src/templates_bundle.ts";
import { CodexHarness } from "../../../src/infrastructure/harness/codex_harness.ts";
import { OpenCodeHarness } from "../../../src/infrastructure/harness/opencode_harness.ts";
import {
  frontmatterField,
  splitFrontmatter,
} from "../../../src/infrastructure/harness/frontmatter.ts";
import { grantedCapabilities, isReadOnlyGrant } from "../../../src/domain/tool_grant.ts";
import type { CoreBundle } from "../../../src/domain/core_bundle.ts";

/**
 * Each bundled seat's grant, as the harness receives it. A grant that holds
 * only on Claude Code is a grant on one harness of several: these cases read
 * what Codex and OpenCode are actually given for every seat in the bundle.
 */

const OPTS = { backlogBackend: "local", versionScheme: "semver", specBackend: "local" } as const;
const seats = CORE_BUNDLE.filter((e) => e.category === "agent");
const toolsOf = (content: string) => {
  const split = splitFrontmatter(content);
  return split ? frontmatterField(split.fmBody, "tools") : null;
};

Deno.test("the bundle ships the seats these cases read", () => {
  assert(seats.length >= 9, `found ${seats.length} agents; the population stopped looking`);
  assert(seats.some((s) => isReadOnlyGrant(toolsOf(s.content))), "no read-only seat to check");
});

/** What Codex gets for a read-only grant: the shell and the permission request switched off. */
const NO_SHELL = { shell_tool: false, request_permissions_tool: false };

Deno.test("Codex runs every bundled seat with a read-only grant without the shell tool", () => {
  const out = new CodexHarness().mapBundle(seats, OPTS);
  for (const seat of seats) {
    const toml = parseToml(out[`.codex/agents/${seat.name}.toml`].content);
    const expected = isReadOnlyGrant(toolsOf(seat.content)) ? NO_SHELL : undefined;
    assertEquals(toml.features, expected, seat.name);
    assertEquals(toml.sandbox_mode, undefined, `${seat.name}: a seat file cannot set it`);
    assertEquals(typeof toml.developer_instructions, "string", `${seat.name}: top level`);
  }
});

/** The `permission:` map an OpenCode agent file carries, and its first key. */
const permissionOf = (md: string) => {
  const fm = parseYaml(splitFrontmatter(md)!.fmBody) as { permission: Record<string, unknown> };
  return { map: fm.permission, first: /^permission:\n {2}(\S+):/m.exec(md)?.[1] };
};
/** A read-only grant on OpenCode: every tool denied, then its read tools allowed back. */
const READ_ONLY = { "*": "deny", read: "allow", list: "allow", grep: "allow", glob: "allow" };

Deno.test("OpenCode denies every capability a seat's grant does not hold", () => {
  const out = new OpenCodeHarness().mapBundle(seats, OPTS);
  for (const seat of seats) {
    const md = out[`.opencode/agents/specnaut-${seat.name}.md`].content;
    const granted = grantedCapabilities(toolsOf(seat.content));
    assert(granted !== null, `${seat.name} has no tools line`);
    if (toolsOf(seat.content) === "Read, Grep, Glob") {
      assertEquals(permissionOf(md), { map: READ_ONLY, first: '"*"' }, seat.name);
      continue;
    }
    for (const capability of ["write", "edit", "bash", "webfetch", "websearch"] as const) {
      const denied = new RegExp(`^  ${capability}: deny$`, "m").test(md);
      assertEquals(denied, !granted.has(capability), `${seat.name}: ${capability}`);
    }
  }
});

/** A synthetic agent with `tools` as its grant, or no tools line at all. */
function agentEntry(name: string, tools: string | null): CoreBundle[number] {
  const line = tools === null ? "" : `tools: ${tools}\n`;
  return {
    category: "agent",
    name,
    suffix: null,
    content: `---\nname: ${name}\ndescription: ${name} role\n${line}---\n\n# Body\n`,
    executable: false,
  };
}

Deno.test("CodexHarness drops the shell only for a grant of tools that run and write nothing", () => {
  const mapped = new CodexHarness().mapBundle([
    agentEntry("agented", "Read, Agent(developer)"),
    agentEntry("reader", "Read, Grep, Glob"),
    agentEntry("fetcher", "Read, WebFetch"),
    agentEntry("shell", "Read, Bash"),
    agentEntry("patterned", "Read, Bash(echo *)"),
    agentEntry("writer", "Read, Write"),
    agentEntry("editor", "Read, Edit"),
    agentEntry("untooled", null),
  ], OPTS);
  const features = (name: string) =>
    parseToml(mapped[`.codex/agents/${name}.toml`].content).features;
  assertEquals(features("reader"), NO_SHELL);
  assertEquals(features("fetcher"), NO_SHELL);
  for (const name of ["agented", "shell", "patterned", "writer", "editor", "untooled"]) {
    assertEquals(features(name), undefined, `${name} must keep the session's tools`);
  }
});

Deno.test("a read-only grant on OpenCode denies by default, MCP, task and skill included", () => {
  const bundle = new OpenCodeHarness().mapBundle([
    agentEntry("seat", "Read, Grep, Glob"),
    agentEntry("fetcher", "Read, WebFetch"),
  ], OPTS);
  const of = (n: string) => permissionOf(bundle[`.opencode/agents/specnaut-${n}.md`].content);
  assertEquals(of("seat"), { map: READ_ONLY, first: '"*"' });
  assertEquals(of("fetcher").map, { "*": "deny", read: "allow", list: "allow", webfetch: "ask" });
});

Deno.test("agent maps NotebookEdit to edit", () => {
  const bundle = new OpenCodeHarness().mapBundle([agentEntry("nb", "Read, NotebookEdit")], OPTS);
  assertStringIncludes(bundle[".opencode/agents/specnaut-nb.md"].content, "edit: allow");
});

Deno.test("agent grants nothing for Grep/Glob/Task/TodoWrite and unknowns, and denies the rest", () => {
  const bundle = new OpenCodeHarness().mapBundle([
    agentEntry("dev", "Grep, Glob, Task, TodoWrite, Mystery"),
  ], OPTS);
  const content = bundle[".opencode/agents/specnaut-dev.md"].content;
  assertEquals(content.includes("allow"), false);
  for (const key of ["write", "edit", "bash", "webfetch", "websearch"]) {
    assertStringIncludes(content, `  ${key}: deny`);
  }
  assertEquals(content.includes("read:"), false, "read is never denied");
});
