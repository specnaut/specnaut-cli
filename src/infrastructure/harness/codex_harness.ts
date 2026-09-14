import { managedSectionField } from "./harness_managed.ts";
import { stringify as stringifyToml } from "@std/toml";
import type { BundleOptions, Harness } from "../../application/ports.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import { HARNESS_STATIC } from "../../templates_bundle.ts";
import {
  CODEX_CONFIG_BLOCK_LABEL,
  CODEX_CONFIG_REFUSAL,
  codexAgentDefaultsBlock,
} from "../../domain/codex_config.ts";
import { ensureSkillFrontmatter, skillDocDestination, skillFolderName } from "./skill_folder.ts";
import { frontmatterField, splitFrontmatter } from "./frontmatter.ts";
import { effortToCodexReasoning, tierToCodexModel } from "../../domain/codex_models.ts";
import { applyBackend, backlogScriptDestination } from "./backlog_filter.ts";
import { applyScheme, phaseScriptDestination } from "./scheme_filter.ts";
import { applySpecBackend } from "./spec_backend_filter.ts";
import { applySpecAutogen } from "./spec_autogen_filter.ts";
import { addUnique } from "./bundle_writer.ts";
import { SKILL_SURFACE } from "./skill_layout.ts";

function parseAgentFrontmatter(
  content: string,
): { description: string; model: string | null; effort: string | null; body: string } {
  const split = splitFrontmatter(content);
  if (!split) return { description: "", model: null, effort: null, body: content };
  return {
    description: frontmatterField(split.fmBody, "description") ?? "",
    model: frontmatterField(split.fmBody, "model"),
    effort: frontmatterField(split.fmBody, "effort"),
    body: split.rest.replace(/^\n+/, ""),
  };
}

function toCodexSubagentToml(entry: CoreEntry): string {
  const { description, model, effort, body } = parseAgentFrontmatter(entry.content);
  const codexModel = tierToCodexModel(model);
  const reasoning = effortToCodexReasoning(effort);
  return stringifyToml({
    name: entry.name,
    description: description || `Specnaut ${entry.name} agent`,
    ...(codexModel ? { model: codexModel } : {}),
    ...(reasoning ? { model_reasoning_effort: reasoning } : {}),
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
      const entry = applySpecAutogen(
        applySpecBackend(applyScheme(backendApplied, opts), opts),
        opts,
      );
      // agent-memory and the agent-fleet README are Claude-only conventions;
      // other harnesses skip them.
      if (entry.category === "agent-memory" || entry.category === "agent-doc") continue;
      switch (entry.category) {
        case "agent":
          addUnique(out, `.codex/agents/${entry.name}.toml`, {
            content: toCodexSubagentToml(entry),
            executable: false,
          }, this.key);
          break;
        case "skill":
        case "backlog-skill": {
          const name = skillFolderName(entry);
          addUnique(out, `.agents/skills/${name}/SKILL.md`, {
            content: ensureSkillFrontmatter(entry.content, name),
            executable: entry.executable,
          }, this.key);
          break;
        }
        case "backlog-doc":
        case "phase": {
          // One shape: a document beside its skill, in that skill's folder.
          const dest = skillDocDestination(entry, SKILL_SURFACE.codex.layout);
          addUnique(out, dest, {
            content: entry.content,
            executable: entry.executable,
          }, this.key);
          break;
        }
        case "phase-script":
          addUnique(out, phaseScriptDestination(entry), {
            content: entry.content,
            executable: entry.executable,
          }, this.key);
          break;
        case "backlog-script":
          addUnique(out, backlogScriptDestination(entry), {
            content: entry.content,
            executable: entry.executable,
          }, this.key);
          break;
        case "spec-root":
          if (!entry.suffix) throw new Error(`spec-root needs suffix`);
          addUnique(out, `.specnaut/${entry.suffix}`, {
            content: entry.content,
            executable: entry.executable,
            ...(entry.skipIfExists ? { skipIfExists: true as const } : {}),
            ...managedSectionField(entry),
          }, this.key);
          break;
        case "project-root":
          if (!entry.suffix) throw new Error(`project-root needs suffix`);
          addUnique(out, entry.suffix, {
            content: entry.content,
            executable: entry.executable,
            ...(entry.skipIfExists ? { skipIfExists: true as const } : {}),
            ...managedSectionField(entry),
          }, this.key);
          break;
        case "mergeable-project-root":
          if (!entry.suffix) throw new Error(`mergeable-project-root needs suffix`);
          addUnique(out, entry.suffix, {
            content: entry.content,
            executable: entry.executable,
            mergeBlock: "gitignore",
          }, this.key);
          break;
      }
    }
    const staticFiles = HARNESS_STATIC[this.key] ?? {};
    for (const [dest, file] of Object.entries(staticFiles)) {
      out[dest] = file;
    }

    // `[agents]` defaults for children spawned without a role (cli#599).
    //
    // Synthesised here rather than shipped as a static template because the
    // model id must come from `codex_models.ts` — that file states it is the
    // only place to edit when OpenAI renames a model, and a template carrying
    // the literal would become the second, drifting on exactly the release
    // that renamed it.
    //
    // A merge block, not `skipIfExists`: anyone who already keeps a
    // `.codex/config.toml` is the normal case AND the population with this
    // bug, so write-once-at-init would skip precisely the users who need it
    // and `upgrade` could never deliver a correction afterwards.
    out[".codex/config.toml"] = {
      content: codexAgentDefaultsBlock(),
      executable: false,
      mergeBlock: CODEX_CONFIG_BLOCK_LABEL,
      mergeRefuseIf: CODEX_CONFIG_REFUSAL,
    };
    return out;
  }
}
