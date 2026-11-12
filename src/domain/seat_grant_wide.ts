import type { KnownHarness } from "./installed_lock.ts";
import { type Capability, grantedCapabilities } from "./tool_grant.ts";

/**
 * Which of the shell and write tools an agent file still grants, read from the
 * file as the harness renders it. The product owner proposes and a bundled
 * executor applies, so its shipped grant holds none of them; a project file
 * that does — a customised copy upgrade kept, an older release's — is named.
 *
 * Each harness carries the grant in its own shape:
 * - **Claude Code, Antigravity**: the frontmatter's `tools:` line. No line is
 *   the harness default, every tool.
 * - **OpenCode**: the `permission:` block; a capability is granted unless it
 *   is set to `deny`, or the block opens with `"*": deny` and never names it.
 * - **Codex**: only the shell can be switched off (`shell_tool = false`), so
 *   that is all a file can be read for.
 *
 * Which tools grant each capability is `tool_grant.ts`'s map, read here and
 * never re-spelled: a tool it gains is wide here too.
 */
const WIDE: ReadonlyArray<readonly [string, Capability]> = [
  ["Bash", "bash"],
  ["Write", "write"],
  ["Edit", "edit"],
];

/** The frontmatter body of a Markdown agent file, or `null` without one. */
function frontmatter(content: string): string | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  return m ? m[1] : null;
}

/** `Bash`, `Write` and `Edit`, those of them the file grants, in that order. */
export function wideGrant(harness: KnownHarness, content: string): string[] {
  if (harness === "codex") {
    return /^\s*shell_tool\s*=\s*false\s*$/m.test(content) ? [] : ["Bash"];
  }
  const fm = frontmatter(content) ?? "";
  if (harness === "opencode") {
    const all = /^\s+"\*":\s*deny\s*$/m.test(fm);
    const denied = (key: string) =>
      new RegExp(`^\\s+${key}:\\s*deny\\s*$`, "m").test(fm) ||
      (all && !new RegExp(`^\\s+${key}:`, "m").test(fm));
    return WIDE.filter(([, capability]) => !denied(capability)).map(([name]) => name);
  }
  const line = /^tools:[ \t]*(.*)$/m.exec(fm)?.[1].trim() ?? "";
  const granted = grantedCapabilities(line);
  if (granted === null) return WIDE.map(([name]) => name);
  return WIDE.filter(([, capability]) => granted.has(capability)).map(([name]) => name);
}
