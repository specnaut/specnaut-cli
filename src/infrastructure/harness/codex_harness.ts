import { managedSectionField, ownershipFields } from "./harness_managed.ts";
import { stringify as stringifyToml } from "@std/toml";
import type { Harness } from "../../application/ports.ts";
import type { BundleOptions } from "../../application/bundle_options.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import type { HookTrust } from "../../domain/hook_trust.ts";
import { HARNESS_STATIC } from "../../templates_bundle.ts";
import { applyHarnessStatic } from "./harness_static.ts";
import {
  CODEX_CONFIG_BLOCK_LABEL,
  CODEX_CONFIG_REFUSAL,
  codexAgentDefaultsBlock,
} from "../../domain/codex_config.ts";
import { ensureSkillFrontmatter, skillDocDestination, skillFolderName } from "./skill_folder.ts";
import { frontmatterField, splitFrontmatter } from "./frontmatter.ts";
import { codexFamilyOf, effortToCodexReasoning } from "../../domain/codex_models.ts";
import { applyBackend, applyHarness, backlogScriptDestination } from "./backlog_filter.ts";
import { applyScheme, phaseScriptDestination } from "./scheme_filter.ts";
import { applySpecBackend } from "./spec_backend_filter.ts";
import { applySpecAutogen } from "./spec_autogen_filter.ts";
import { addUnique } from "./bundle_writer.ts";
import { SKILL_SURFACE } from "./skill_layout.ts";
import { AGENT_FOLDERS, agentFile } from "../../domain/agent_folders.ts";

const AGENTS = AGENT_FOLDERS.codex;

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
  // No `model` key: Specnaut names no model version (codex_models.ts). The
  // family is a comment, so the agent runs on the session's model and the
  // user still sees which family it was written for.
  const { description, model, effort, body } = parseAgentFrontmatter(entry.content);
  const family = codexFamilyOf(model);
  const reasoning = effortToCodexReasoning(effort);
  const toml = stringifyToml({
    name: entry.name,
    description: description || `Specnaut ${entry.name} agent`,
    ...(reasoning ? { model_reasoning_effort: reasoning } : {}),
    developer_instructions: body,
  });
  return family === null
    ? toml
    : `# Model family: ${family} (${model!.trim().toLowerCase()} on Claude Code)\n${toml}`;
}

export class CodexHarness implements Harness {
  readonly key = "codex";
  readonly displayName = "Codex CLI";
  /** `.specnaut/hooks/`: see `ClaudeHarness.managedRoots` for why it is not a shared root. */
  readonly managedRoots = [`${AGENTS.dir}/`, ".agents/skills/", ".specnaut/hooks/"] as const;
  /**
   * Retired files directly in `.codex/`, which no root may hold: the folder's
   * other files are the user's. `goal.md` was retired by cli#681 — Codex's
   * `/goal` reads no file, and the only pointer to it sat in a context file
   * Codex never read. It stays listed until no supported upgrade path has it.
   */
  readonly managedFiles = [".codex/goal.md"] as const;
  /**
   * Codex hashes each registration in `.codex/hooks.json` and runs none until
   * the user trusts it through `/hooks` (plan § 11, "Measured"). Every command
   * pins `.specnaut/hooks/SHA256SUMS`, so a change to either path voids it.
   */
  readonly hookTrust: HookTrust = {
    paths: [".codex/hooks.json", ".specnaut/hooks/"],
    registry: ".codex/hooks.json",
    note: "Codex runs project hooks only once you trust them: open Codex here and run /hooks, " +
      "then trust Specnaut's hooks. Until then the merge, release, generated-file, constitution " +
      "and model guards do not run.",
  };

  mapBundle(core: CoreBundle, opts: BundleOptions): Bundle {
    const out: Bundle = {};
    for (const raw of core) {
      const backendApplied = applyBackend(applyHarness(raw, this.key), opts);
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
          addUnique(out, agentFile(AGENTS, entry.name), {
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
            ...ownershipFields(entry),
            ...managedSectionField(entry),
          }, this.key);
          break;
        case "project-root":
          if (!entry.suffix) throw new Error(`project-root needs suffix`);
          addUnique(out, entry.suffix, {
            content: entry.content,
            executable: entry.executable,
            ...ownershipFields(entry),
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
    applyHarnessStatic(out, HARNESS_STATIC[this.key] ?? {}, opts);

    // `[agents]` defaults for children spawned without a role (cli#599).
    //
    // Synthesised here so its keys come from `codex_config.ts`, the one place
    // that decides them.
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
