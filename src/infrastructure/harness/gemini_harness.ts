import { stringify as stringifyToml } from "@std/toml";
import type { BundleOptions, Harness } from "../../application/ports.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import { ensureSkillFrontmatter, skillFolderName } from "./skill_folder.ts";
import { frontmatterField, splitFrontmatter } from "./frontmatter.ts";
import { applyBackend, backlogScriptDestination } from "./backlog_filter.ts";

function toGeminiCommandToml(entry: CoreEntry): string {
  const split = splitFrontmatter(entry.content);
  const fmBody = split?.fmBody ?? "";
  const body = split ? split.rest.replace(/^\n+/, "") : entry.content;
  const description = frontmatterField(fmBody, "description");
  const out: Record<string, string> = { prompt: body };
  if (description) out.description = description;
  return stringifyToml(out);
}

function toGeminiSubagentMarkdown(entry: CoreEntry): string {
  const split = splitFrontmatter(entry.content);
  const fmBody = split?.fmBody ?? "";
  const body = split ? split.rest.replace(/^\n+/, "") : entry.content;
  const description = frontmatterField(fmBody, "description") ??
    `Specflow ${entry.name} agent`;
  return `---\nname: ${entry.name}\ndescription: ${description}\n---\n\n${body}`;
}

export class GeminiHarness implements Harness {
  readonly key = "gemini";
  readonly displayName = "Gemini CLI";

  mapBundle(core: CoreBundle, opts: BundleOptions): Bundle {
    const out: Bundle = {};
    for (const raw of core) {
      const entry = applyBackend(raw, opts);
      if (entry === null) continue;
      // agent-memory is Claude-only (folder convention); other harnesses skip.
      if (entry.category === "agent-memory") continue;
      switch (entry.category) {
        case "command":
        case "backlog-cmd": {
          const name = skillFolderName(entry);
          out[`.gemini/commands/${name}.toml`] = {
            content: toGeminiCommandToml(entry),
            executable: false,
          };
          break;
        }
        case "skill":
        case "backlog-skill": {
          const name = skillFolderName(entry);
          out[`.gemini/skills/${name}/SKILL.md`] = {
            content: ensureSkillFrontmatter(entry.content, name),
            executable: entry.executable,
          };
          break;
        }
        case "backlog-script":
          out[backlogScriptDestination(entry)] = {
            content: entry.content,
            executable: entry.executable,
          };
          break;
        case "agent":
          out[`.gemini/agents/${entry.name}.md`] = {
            content: toGeminiSubagentMarkdown(entry),
            executable: false,
          };
          break;
        case "spec-root":
          if (!entry.suffix) throw new Error(`spec-root needs suffix`);
          out[`.specflow/${entry.suffix}`] = {
            content: entry.content,
            executable: entry.executable,
          };
          break;
        case "project-root":
          if (!entry.suffix) throw new Error(`project-root needs suffix`);
          out[entry.suffix] = {
            content: entry.content,
            executable: entry.executable,
          };
          break;
        case "mergeable-project-root":
          if (!entry.suffix) throw new Error(`mergeable-project-root needs suffix`);
          out[entry.suffix] = {
            content: entry.content,
            executable: entry.executable,
            mergeBlock: "gitignore",
          };
          break;
      }
    }
    return out;
  }
}
