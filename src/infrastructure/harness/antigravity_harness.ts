import type { Harness } from "../../application/ports.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import { ensureSkillFrontmatter, skillFolderName } from "./skill_folder.ts";
import { frontmatterField, splitFrontmatter } from "./frontmatter.ts";

function toAntigravityWorkflowMarkdown(entry: CoreEntry): string {
  const split = splitFrontmatter(entry.content);
  const body = split ? split.rest.replace(/^\n+/, "") : entry.content;
  const description = split ? frontmatterField(split.fmBody, "description") : null;
  const fm = description !== null ? `description: ${description}` : `description: ${entry.name}`;
  return `---\n${fm}\n---\n\n${body}`;
}

function toAntigravityAgentMarkdown(entry: CoreEntry): string {
  const split = splitFrontmatter(entry.content);
  const fmBody = split?.fmBody ?? "";
  const body = split ? split.rest.replace(/^\n+/, "") : entry.content;
  const description = frontmatterField(fmBody, "description") ??
    `Specflow ${entry.name} agent`;
  const tools = frontmatterField(fmBody, "tools");
  const model = frontmatterField(fmBody, "model");
  const skills = frontmatterField(fmBody, "skills");
  const lines: string[] = [
    `name: specflow-${entry.name}`,
    `description: ${description}`,
  ];
  if (tools !== null) lines.push(`tools: ${tools}`);
  if (model !== null) lines.push(`model: ${model}`);
  if (skills !== null) lines.push(`skills: ${skills}`);
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

function destinationFor(entry: CoreEntry): string {
  switch (entry.category) {
    case "command":
      return `.agent/workflows/specflow-${entry.name}.md`;
    case "backlog-cmd":
      return `.agent/workflows/${entry.name}.md`;
    case "agent":
      return `.agent/agents/specflow-${entry.name}.md`;
    case "skill":
      return `.agent/skills/${skillFolderName(entry)}/SKILL.md`;
    case "spec-root":
      if (!entry.suffix) throw new Error(`spec-root needs suffix`);
      return `.specflow/${entry.suffix}`;
    case "project-root":
      if (!entry.suffix) throw new Error(`project-root needs suffix`);
      return entry.suffix;
  }
}

export class AntigravityHarness implements Harness {
  readonly key = "antigravity";
  readonly displayName = "Antigravity";

  mapBundle(core: CoreBundle): Bundle {
    const out: Bundle = {};
    for (const entry of core) {
      const dest = destinationFor(entry);
      let content: string;
      switch (entry.category) {
        case "command":
        case "backlog-cmd":
          content = toAntigravityWorkflowMarkdown(entry);
          break;
        case "agent":
          content = toAntigravityAgentMarkdown(entry);
          break;
        case "skill":
          content = ensureSkillFrontmatter(entry.content, skillFolderName(entry));
          break;
        default:
          content = entry.content;
      }
      out[dest] = { content, executable: entry.executable };
    }
    return out;
  }
}
