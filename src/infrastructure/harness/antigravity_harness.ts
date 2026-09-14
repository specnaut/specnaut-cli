import { managedSectionField } from "./harness_managed.ts";
import type { BundleOptions, Harness } from "../../application/ports.ts";
import { HARNESS_STATIC } from "../../templates_bundle.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import { ensureSkillFrontmatter, skillDocDestination, skillFolderName } from "./skill_folder.ts";
import { frontmatterField, splitFrontmatter } from "./frontmatter.ts";
import { tierToAntigravityModel } from "../../domain/antigravity_models.ts";
import { applyBackend, backlogScriptDestination } from "./backlog_filter.ts";
import { applyScheme, phaseScriptDestination } from "./scheme_filter.ts";
import { applySpecBackend } from "./spec_backend_filter.ts";
import { applySpecAutogen } from "./spec_autogen_filter.ts";
import { addUnique } from "./bundle_writer.ts";
import { SKILL_SURFACE } from "./skill_layout.ts";

function toAntigravityAgentMarkdown(entry: CoreEntry): string {
  const split = splitFrontmatter(entry.content);
  const fmBody = split?.fmBody ?? "";
  const body = split ? split.rest.replace(/^\n+/, "") : entry.content;
  const description = frontmatterField(fmBody, "description") ??
    `Specnaut ${entry.name} agent`;
  const tools = frontmatterField(fmBody, "tools");
  const model = frontmatterField(fmBody, "model");
  const skills = frontmatterField(fmBody, "skills");
  const lines: string[] = [
    `name: specnaut-${entry.name}`,
    `description: ${description}`,
    // Without this, Antigravity discovers the file but the primary agent
    // cannot reach it through `invoke_subagent` — the seat scaffolds and is
    // then undispatchable, which looks identical to a working install.
    "subagent: true",
  ];
  if (tools !== null) lines.push(`tools: ${tools}`);
  const agModel = tierToAntigravityModel(model);
  if (agModel !== null) lines.push(`model: ${agModel}`);
  if (skills !== null) lines.push(`skills: ${skills}`);
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

function destinationFor(entry: CoreEntry): string {
  switch (entry.category) {
    case "agent":
      return `.agents/agents/specnaut-${entry.name}.md`;
    case "skill":
    case "backlog-skill":
      return `.agents/skills/${skillFolderName(entry)}/SKILL.md`;
    case "backlog-doc":
    case "phase":
      // One shape: a document beside its skill, in that skill's own folder.
      return skillDocDestination(entry, SKILL_SURFACE.antigravity.layout);
    case "phase-script":
      return phaseScriptDestination(entry);
    case "backlog-script":
      return backlogScriptDestination(entry);
    case "agent-memory":
      throw new Error("agent-memory entries should be filtered before destinationFor");
    case "agent-doc":
      throw new Error("agent-doc entries should be filtered before destinationFor");
    case "spec-root":
      if (!entry.suffix) throw new Error(`spec-root needs suffix`);
      return `.specnaut/${entry.suffix}`;
    case "project-root":
    case "mergeable-project-root":
      if (!entry.suffix) throw new Error(`${entry.category} needs suffix`);
      return entry.suffix;
  }
}

export class AntigravityHarness implements Harness {
  readonly key = "antigravity";
  readonly displayName = "Antigravity";

  mapBundle(core: CoreBundle, opts: BundleOptions): Bundle {
    const out: Bundle = {};
    for (const raw of core) {
      const backendApplied = applyBackend(raw, opts);
      if (backendApplied === null) continue;
      const entry = applySpecAutogen(
        applySpecBackend(applyScheme(backendApplied, opts), opts),
        opts,
      );
      // agent-memory and the agent-fleet README are Claude-only conventions;
      // other harnesses skip them.
      if (entry.category === "agent-memory" || entry.category === "agent-doc") continue;
      const dest = destinationFor(entry);
      let content: string;
      switch (entry.category) {
        case "agent":
          content = toAntigravityAgentMarkdown(entry);
          break;
        case "skill":
        case "backlog-skill":
          content = ensureSkillFrontmatter(entry.content, skillFolderName(entry));
          break;
        default:
          content = entry.content;
      }
      addUnique(out, dest, {
        content,
        executable: entry.executable,
        ...(entry.category === "mergeable-project-root" ? { mergeBlock: "gitignore" } : {}),
        ...(entry.skipIfExists ? { skipIfExists: true as const } : {}),
        ...managedSectionField(entry),
      }, this.key);
    }
    // Layer the harness's own static files last, so a harness-specific file
    // wins over anything the core bundle mapped to the same destination.
    const staticFiles = HARNESS_STATIC[this.key] ?? {};
    for (const [dest, file] of Object.entries(staticFiles)) {
      out[dest] = file;
    }
    return out;
  }
}
