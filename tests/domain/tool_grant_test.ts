import { assert, assertEquals } from "@std/assert";
import {
  CAPABILITIES,
  type Capability,
  grantedCapabilities,
  isReadOnlyGrant,
  toolEntries,
  toolNames,
} from "../../src/domain/tool_grant.ts";

const sorted = (s: ReadonlySet<Capability> | null) => s === null ? null : [...s].sort();

Deno.test("toolNames splits at depth 0 and drops a parenthesised specifier", () => {
  assertEquals(toolNames("Read, Bash(git log *), Agent(a, b), Glob"), [
    "Read",
    "Bash",
    "Agent",
    "Glob",
  ]);
  assertEquals(toolNames("  "), []);
});

Deno.test("a grant maps each tool to the capability a harness can enforce", () => {
  assertEquals(sorted(grantedCapabilities("Read, Grep, Glob")), ["read"]);
  assertEquals(sorted(grantedCapabilities("Read, Write, Edit, Bash")), [
    "bash",
    "edit",
    "read",
    "write",
  ]);
  assertEquals(sorted(grantedCapabilities("MultiEdit, NotebookEdit")), ["edit"]);
  assertEquals(sorted(grantedCapabilities("WebFetch, WebSearch")), ["webfetch", "websearch"]);
  // A specifier does not narrow a tool: `Bash(<pattern>)` grants the shell.
  assertEquals(sorted(grantedCapabilities("Read, Bash(echo *)")), ["bash", "read"]);
});

Deno.test("no tools line is not an empty grant: the harness default applies", () => {
  assertEquals(grantedCapabilities(null), null);
  assertEquals(grantedCapabilities(""), null);
  assertEquals(isReadOnlyGrant(null), false);
});

Deno.test("a grant is read-only only when every tool it names runs and writes nothing", () => {
  assert(isReadOnlyGrant("Read, Grep, Glob"));
  assert(isReadOnlyGrant("Read, WebFetch, Grep"));
  for (const tools of ["Read, Bash", "Read, Bash(echo *)", "Read, Write", "Edit", "NotebookEdit"]) {
    assertEquals(isReadOnlyGrant(tools), false, tools);
  }
});

Deno.test("an unknown tool or an Agent grant is never read-only", () => {
  for (
    const tools of ["Read, Mystery", "Read, Agent(developer)", "Read, Agent", "Read, TodoWrite"]
  ) {
    assertEquals(isReadOnlyGrant(tools), false, tools);
  }
});

Deno.test("toolEntries keeps each specifier; toolNames drops it", () => {
  assertEquals(toolEntries("Read, Agent(a, b), Bash(x *)"), ["Read", "Agent(a, b)", "Bash(x *)"]);
  assertEquals(toolNames("Read, Agent(a, b), Bash(x *)"), ["Read", "Agent", "Bash"]);
});

Deno.test("the enforceable capabilities are the six a renderer can deny", () => {
  assertEquals([...CAPABILITIES], ["read", "write", "edit", "bash", "webfetch", "websearch"]);
});
