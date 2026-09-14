import { managedSectionField } from "./harness_managed.ts";
import type { BundleOptions, Harness } from "../../application/ports.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import { HARNESS_STATIC } from "../../templates_bundle.ts";
import { applyBackend, backlogScriptDestination } from "./backlog_filter.ts";
import { applyScheme, phaseScriptDestination } from "./scheme_filter.ts";
import { applySpecBackend } from "./spec_backend_filter.ts";
import { applySpecAutogen } from "./spec_autogen_filter.ts";
import { ensureSkillFrontmatter, skillDocDestination } from "./skill_folder.ts";
import { addUnique } from "./bundle_writer.ts";

function destinationFor(entry: CoreEntry): string {
  switch (entry.category) {
    case "agent":
      return `.claude/agents/${entry.name}.md`;
    case "agent-memory":
      if (!entry.suffix) throw new Error(`agent-memory needs suffix: ${entry.name}`);
      return `.claude/agents/${entry.name}/memory/${entry.suffix}`;
    case "agent-doc":
      // The agent-fleet README is a Claude-only convention; it sits beside the
      // agent files at `.claude/agents/README.md`. Other harnesses skip it
      // (the agents are transformed into harness-specific formats there, so a
      // README describing the `.claude/agents/` layout has no destination).
      if (!entry.suffix) throw new Error(`agent-doc needs suffix: ${entry.name}`);
      return `.claude/agents/${entry.suffix}`;
    case "skill":
    case "backlog-skill":
      // Claude doesn't add a `specnaut-` prefix — skill names are emitted
      // verbatim as the folder name (`specnaut`, `board`,
      // `specnaut-review`, …).
      return `.claude/skills/${entry.name}/SKILL.md`;
    case "backlog-doc":
    case "phase":
      // One shape: a document beside its skill, loaded by that skill from its
      // own directory. Claude emits skill names verbatim, so the owner folder
      // takes no namespacing prefix.
      return skillDocDestination(entry, {
        kind: "nested",
        root: ".claude/skills",
        namespaced: false,
      });
    case "phase-script":
      return phaseScriptDestination(entry);
    case "backlog-script":
      return backlogScriptDestination(entry);
    case "spec-root":
      if (!entry.suffix) throw new Error(`spec-root entry needs suffix: ${entry.name}`);
      return `.specnaut/${entry.suffix}`;
    case "project-root":
    case "mergeable-project-root":
      if (!entry.suffix) throw new Error(`${entry.category} needs suffix: ${entry.name}`);
      return entry.suffix;
  }
}

export class ClaudeHarness implements Harness {
  readonly key = "claude";
  readonly displayName = "Claude Code";

  mapBundle(core: CoreBundle, opts: BundleOptions): Bundle {
    const out: Bundle = {};
    for (const raw of core) {
      const backendApplied = applyBackend(raw, opts);
      if (backendApplied === null) continue;
      const entry = applySpecAutogen(
        applySpecBackend(applyScheme(backendApplied, opts), opts),
        opts,
      );

      // Skill-folder categories ship as `.claude/skills/<name>/SKILL.md`.
      // Claude Code derives the skill name from the folder, but we inject
      // an explicit `name:` (matching the folder) for parity with how
      // cursor / codex emit their skill folders.
      let content = entry.content;
      if (entry.category === "skill" || entry.category === "backlog-skill") {
        content = ensureSkillFrontmatter(content, entry.name);
      }

      addUnique(out, destinationFor(entry), {
        content,
        executable: entry.executable,
        ...(entry.category === "mergeable-project-root" ? { mergeBlock: "gitignore" } : {}),
        ...(entry.skipIfExists ? { skipIfExists: true as const } : {}),
        ...managedSectionField(entry),
      }, this.key);
    }
    const staticFiles = HARNESS_STATIC[this.key] ?? {};
    for (const [dest, file] of Object.entries(staticFiles)) {
      out[dest] = file;
    }
    return out;
  }
}
