import { stringify as stringifyToml } from "@std/toml";
import type { Harness } from "../../application/ports.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import { ensureSkillFrontmatter, skillFolderName } from "./skill_folder.ts";
import { frontmatterField, splitFrontmatter } from "./frontmatter.ts";

function parseAgentFrontmatter(content: string): { description: string; body: string } {
  const split = splitFrontmatter(content);
  if (!split) return { description: "", body: content };
  return {
    description: frontmatterField(split.fmBody, "description") ?? "",
    body: split.rest.replace(/^\n+/, ""),
  };
}

function toCodexSubagentToml(entry: CoreEntry): string {
  const { description, body } = parseAgentFrontmatter(entry.content);
  return stringifyToml({
    name: entry.name,
    description: description || `Specflow ${entry.name} agent`,
    developer_instructions: body,
  });
}

export class CodexHarness implements Harness {
  readonly key = "codex";
  readonly displayName = "Codex CLI";

  mapBundle(core: CoreBundle): Bundle {
    const out: Bundle = {};
    for (const entry of core) {
      switch (entry.category) {
        case "agent":
          out[`.codex/agents/${entry.name}.toml`] = {
            content: toCodexSubagentToml(entry),
            executable: false,
          };
          break;
        case "command":
        case "backlog-cmd":
        case "skill": {
          const name = skillFolderName(entry);
          out[`.agents/skills/${name}/SKILL.md`] = {
            content: ensureSkillFrontmatter(entry.content, name),
            executable: entry.executable,
          };
          break;
        }
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
      }
    }
    return out;
  }
}
