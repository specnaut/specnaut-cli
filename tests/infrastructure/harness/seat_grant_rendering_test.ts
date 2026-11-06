import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parse as parseToml } from "@std/toml";
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

Deno.test("Codex runs every bundled seat with a read-only grant in its read-only sandbox", () => {
  const out = new CodexHarness().mapBundle(seats, OPTS);
  for (const seat of seats) {
    const toml = parseToml(out[`.codex/agents/${seat.name}.toml`].content);
    const expected = isReadOnlyGrant(toolsOf(seat.content)) ? "read-only" : undefined;
    assertEquals(toml.sandbox_mode, expected, seat.name);
  }
});

Deno.test("OpenCode denies every capability a seat's grant does not hold", () => {
  const out = new OpenCodeHarness().mapBundle(seats, OPTS);
  for (const seat of seats) {
    const md = out[`.opencode/agents/specnaut-${seat.name}.md`].content;
    const granted = grantedCapabilities(toolsOf(seat.content));
    assert(granted !== null, `${seat.name} has no tools line`);
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

Deno.test("CodexHarness runs only a grant of tools that run and write nothing read-only", () => {
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
  const sandbox = (name: string) =>
    parseToml(mapped[`.codex/agents/${name}.toml`].content).sandbox_mode;
  assertEquals(sandbox("reader"), "read-only");
  assertEquals(sandbox("fetcher"), "read-only");
  for (const name of ["agented", "shell", "patterned", "writer", "editor", "untooled"]) {
    assertEquals(sandbox(name), undefined, `${name} must keep the session's sandbox`);
  }
});

Deno.test("agent with a read-only grant denies write, edit and the shell by name", () => {
  const bundle = new OpenCodeHarness().mapBundle([agentEntry("seat", "Read, Grep, Glob")], OPTS);
  const content = bundle[".opencode/agents/specnaut-seat.md"].content;
  assertStringIncludes(content, "read: allow");
  for (const key of ["write", "edit", "bash", "webfetch", "websearch"]) {
    assertStringIncludes(content, `  ${key}: deny`);
  }
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
