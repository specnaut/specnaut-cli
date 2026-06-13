import { stringify as stringifyToml } from "@std/toml";
import type { BundleOptions, Harness } from "../../application/ports.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import { HARNESS_STATIC } from "../../templates_bundle.ts";
import { ensureSkillFrontmatter, skillFolderName } from "./skill_folder.ts";
import { frontmatterField, splitFrontmatter } from "./frontmatter.ts";
import { applyBackend, backlogScriptDestination } from "./backlog_filter.ts";
import { applyScheme, phaseScriptDestination } from "./scheme_filter.ts";

function parseAgentFrontmatter(
  content: string,
): { description: string; model: string | null; body: string } {
  const split = splitFrontmatter(content);
  if (!split) return { description: "", model: null, body: content };
  return {
    description: frontmatterField(split.fmBody, "description") ?? "",
    model: frontmatterField(split.fmBody, "model"),
    body: split.rest.replace(/^\n+/, ""),
  };
}

/**
 * Translates a Specflow agent's declared capability tier (a Claude model name)
 * into a Codex `model_reasoning_effort` level. Codex models are OpenAI-specific,
 * so we map the *tier* rather than copy the vendor model id — keeping the
 * mapping stable across OpenAI model releases. An absent, empty, or
 * unrecognised tier (including `inherit`) returns null so the sub-agent
 * inherits the parent Codex session default instead of getting a guessed value.
 */
function tierToReasoningEffort(model: string | null): string | null {
  switch (model?.trim().toLowerCase()) {
    case "opus":
      return "high";
    case "sonnet":
      return "medium";
    case "haiku":
      return "low";
    default:
      return null;
  }
}

function toCodexSubagentToml(entry: CoreEntry): string {
  const { description, model, body } = parseAgentFrontmatter(entry.content);
  const effort = tierToReasoningEffort(model);
  return stringifyToml({
    name: entry.name,
    description: description || `Specflow ${entry.name} agent`,
    ...(effort ? { model_reasoning_effort: effort } : {}),
    developer_instructions: body,
  });
}

export class CodexHarness implements Harness {
  readonly key = "codex";
  readonly displayName = "Codex CLI";

  mapBundle(core: CoreBundle, opts: BundleOptions): Bundle {
    const out: Bundle = {};
    for (const raw of core) {
      const backendApplied = applyBackend(raw, opts);
      if (backendApplied === null) continue;
      const entry = applyScheme(backendApplied, opts);
      // agent-memory and the agent-fleet README are Claude-only conventions;
      // other harnesses skip them.
      if (entry.category === "agent-memory" || entry.category === "agent-doc") continue;
      switch (entry.category) {
        case "agent":
          out[`.codex/agents/${entry.name}.toml`] = {
            content: toCodexSubagentToml(entry),
            executable: false,
          };
          break;
        case "backlog-cmd":
        case "skill":
        case "backlog-skill": {
          const name = skillFolderName(entry);
          out[`.agents/skills/${name}/SKILL.md`] = {
            content: ensureSkillFrontmatter(entry.content, name),
            executable: entry.executable,
          };
          break;
        }
        case "phase": {
          if (!entry.suffix) throw new Error(`phase needs suffix: ${entry.name}`);
          out[`.agents/skills/specflow/phases/${entry.suffix}`] = {
            content: entry.content,
            executable: entry.executable,
          };
          break;
        }
        case "phase-script":
          out[phaseScriptDestination(entry)] = {
            content: entry.content,
            executable: entry.executable,
          };
          break;
        case "backlog-script":
          out[backlogScriptDestination(entry)] = {
            content: entry.content,
            executable: entry.executable,
          };
          break;
        case "spec-root":
          if (!entry.suffix) throw new Error(`spec-root needs suffix`);
          out[`.specflow/${entry.suffix}`] = {
            content: entry.content,
            executable: entry.executable,
            ...(entry.skipIfExists ? { skipIfExists: true as const } : {}),
          };
          break;
        case "project-root":
          if (!entry.suffix) throw new Error(`project-root needs suffix`);
          out[entry.suffix] = {
            content: entry.content,
            executable: entry.executable,
            ...(entry.skipIfExists ? { skipIfExists: true as const } : {}),
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
    const staticFiles = HARNESS_STATIC[this.key] ?? {};
    for (const [dest, file] of Object.entries(staticFiles)) {
      out[dest] = file;
    }
    return out;
  }
}
