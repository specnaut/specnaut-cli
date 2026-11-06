/**
 * A seat's `tools:` line, read as the capabilities a harness can enforce.
 *
 * The line is written once, in Claude Code's vocabulary, and each harness
 * renders it in its own terms. This module is the one place that decides what
 * the line grants, so every renderer enforces the same reading:
 *
 * - **Claude Code** enforces the list itself: a tool not named is not there.
 * - **OpenCode** gets an explicit `deny` for every capability not granted,
 *   rather than silence, which would leave OpenCode's own default in force. A
 *   read-only grant (`isReadOnlyGrant`) is deny-by-default: `"*": deny`, then
 *   its read tools, so MCP tools, `task`, `skill` and patching are denied too.
 * - **Codex** offers no enforced seat isolation. A seat inherits the parent
 *   session's sandbox, and its agent file can switch the shell tool off but
 *   cannot remove exec, inherited MCP servers or agent spawning. A grant naming
 *   only tools that run and write nothing gets `[features]` with `shell_tool`
 *   and `request_permissions_tool` off, as best effort; the seat's restriction
 *   there rests on its instructions. Any other grant keeps the session's tools.
 * - **Antigravity** receives the line verbatim; what it enforces is its own.
 * - **Cursor and Copilot** run no separate seat, so no grant applies.
 *
 * A parenthesised specifier (`Bash(git log *)`) does not narrow a tool in a
 * subagent's list: it grants the whole tool, and it is read here that way.
 */

/** What a renderer can allow or deny, in a fixed order. */
export const CAPABILITIES = ["read", "write", "edit", "bash", "webfetch", "websearch"] as const;
export type Capability = typeof CAPABILITIES[number];

const TOOL_TO_CAPABILITY: Readonly<Record<string, Capability>> = {
  Read: "read",
  Write: "write",
  Edit: "edit",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  Bash: "bash",
  WebFetch: "webfetch",
  WebSearch: "websearch",
};

/**
 * Tools that run nothing and write nothing. A grant is read-only only when every
 * tool it names is one of these: an unknown name, or `Agent`, which spawns seats
 * whose own grants this line does not bound, is not.
 */
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "Read",
  "Grep",
  "Glob",
  "WebFetch",
  "WebSearch",
]);

/** The entries of a `tools:` value, split at depth 0, each specifier kept. */
export function toolEntries(tools: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of tools) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((t) => t.trim()).filter((t) => t.length > 0);
}

/** The tool names of a `tools:` value, each specifier dropped. */
export function toolNames(tools: string): string[] {
  return toolEntries(tools).map((t) => t.replace(/\(.*$/s, "").trim());
}

/**
 * The capabilities a `tools:` value grants, or `null` when there is no value —
 * no line means the harness default, which is not the same as granting nothing.
 * Tools with no enforceable capability (Grep, Glob, Agent, …) add none.
 */
export function grantedCapabilities(tools: string | null): ReadonlySet<Capability> | null {
  if (tools === null || tools.trim().length === 0) return null;
  const out = new Set<Capability>();
  for (const name of toolNames(tools)) {
    const capability = TOOL_TO_CAPABILITY[name];
    if (capability) out.add(capability);
  }
  return out;
}

/** True when a `tools:` value is present and names only tools that run and write nothing. */
export function isReadOnlyGrant(tools: string | null): boolean {
  if (tools === null || tools.trim().length === 0) return false;
  return toolNames(tools).every((name) => READ_ONLY_TOOLS.has(name));
}
