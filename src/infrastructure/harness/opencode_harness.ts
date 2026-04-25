import type { Harness } from "../../application/ports.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import { ensureSkillFrontmatter, skillFolderName } from "./skill_folder.ts";
import { frontmatterField, splitFrontmatter } from "./frontmatter.ts";

type PermissionValue = "allow" | "ask" | "deny" | { "*": "ask" | "allow" | "deny" };
type PermissionMap = Record<string, PermissionValue>;

function parseToolsList(tools: string): string[] {
  // Split on commas at depth 0 (ignoring commas inside parens like "Agent(a, b)").
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of tools) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      if (current.trim()) out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current.trim());
  // Strip parenthesized suffix: "Bash(git log *)" → "Bash".
  return out.map((t) => t.replace(/\(.*$/, "").trim()).filter((t) => t.length > 0);
}

function translateToolsToPermissions(toolsField: string | null): PermissionMap | null {
  if (toolsField === null || toolsField.trim().length === 0) return null;
  const map: PermissionMap = {};
  for (const tool of parseToolsList(toolsField)) {
    switch (tool) {
      case "Read":
        map.read = "allow";
        break;
      case "Write":
        map.write = "allow";
        break;
      case "Edit":
      case "MultiEdit":
        map.edit = "allow";
        break;
      case "Bash":
        map.bash = { "*": "ask" };
        break;
      case "WebFetch":
        map.webfetch = "ask";
        break;
      case "WebSearch":
        map.websearch = "ask";
        break;
        // Grep, Glob, Task, Agent, TodoWrite, NotebookEdit, unknowns: omit.
    }
  }
  return Object.keys(map).length > 0 ? map : null;
}

function stringifyPermissions(perms: PermissionMap): string {
  const lines: string[] = ["permission:"];
  for (const [key, value] of Object.entries(perms)) {
    if (typeof value === "string") {
      lines.push(`  ${key}: ${value}`);
    } else {
      // bash: { "*": "ask" } → block form
      lines.push(`  ${key}:`);
      for (const [pat, v] of Object.entries(value)) {
        lines.push(`    "${pat}": ${v}`);
      }
    }
  }
  return lines.join("\n");
}

function toOpenCodeCommandMarkdown(entry: CoreEntry): string {
  const split = splitFrontmatter(entry.content);
  const body = split ? split.rest.replace(/^\n+/, "") : entry.content;
  const description = split ? frontmatterField(split.fmBody, "description") : null;
  const fm = description !== null ? `description: ${description}` : `description: ${entry.name}`;
  return `---\n${fm}\n---\n\n${body}`;
}

function toOpenCodeAgentMarkdown(entry: CoreEntry): string {
  const split = splitFrontmatter(entry.content);
  const body = split ? split.rest.replace(/^\n+/, "") : entry.content;
  const description = split ? frontmatterField(split.fmBody, "description") : null;
  const tools = split ? frontmatterField(split.fmBody, "tools") : null;
  const perms = translateToolsToPermissions(tools);
  const lines: string[] = [];
  lines.push(description !== null ? `description: ${description}` : `description: ${entry.name}`);
  lines.push("mode: subagent");
  if (perms !== null) lines.push(stringifyPermissions(perms));
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

function destinationFor(entry: CoreEntry): string {
  switch (entry.category) {
    case "command":
      return `.opencode/commands/specflow.${entry.name}.md`;
    case "backlog-cmd":
      return `.opencode/commands/${entry.name}.md`;
    case "agent":
      return `.opencode/agents/specflow-${entry.name}.md`;
    case "skill":
      return `.opencode/skills/${skillFolderName(entry)}/SKILL.md`;
    case "spec-root":
      if (!entry.suffix) throw new Error(`spec-root needs suffix`);
      return `.specflow/${entry.suffix}`;
    case "project-root":
      if (!entry.suffix) throw new Error(`project-root needs suffix`);
      return entry.suffix;
  }
}

export class OpenCodeHarness implements Harness {
  readonly key = "opencode";
  readonly displayName = "OpenCode";

  mapBundle(core: CoreBundle): Bundle {
    const out: Bundle = {};
    for (const entry of core) {
      const dest = destinationFor(entry);
      let content: string;
      switch (entry.category) {
        case "command":
        case "backlog-cmd":
          content = toOpenCodeCommandMarkdown(entry);
          break;
        case "agent":
          content = toOpenCodeAgentMarkdown(entry);
          break;
        case "skill":
          content = ensureSkillFrontmatter(entry.content, entry.name);
          break;
        default:
          content = entry.content;
      }
      out[dest] = { content, executable: entry.executable };
    }
    return out;
  }
}
