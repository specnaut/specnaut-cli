import { managedSectionField } from "./harness_managed.ts";
import type { BundleOptions, Harness } from "../../application/ports.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import { HARNESS_STATIC } from "../../templates_bundle.ts";
import { ensureSkillFrontmatter, skillDocDestination, skillFolderName } from "./skill_folder.ts";
import { applyBackend, backlogScriptDestination } from "./backlog_filter.ts";
import { applyScheme, phaseScriptDestination } from "./scheme_filter.ts";
import { applySpecBackend } from "./spec_backend_filter.ts";
import { applySpecAutogen } from "./spec_autogen_filter.ts";
import { addUnique } from "./bundle_writer.ts";
import { SKILL_SURFACE } from "./skill_layout.ts";

function destinationFor(entry: CoreEntry): string {
  switch (entry.category) {
    case "agent":
    case "skill":
    case "backlog-skill":
      return `.cursor/skills/${skillFolderName(entry)}/SKILL.md`;
    case "backlog-doc":
    case "phase":
      // One shape: a document beside its skill, in that skill's own folder.
      return skillDocDestination(entry, SKILL_SURFACE.cursor.layout);
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

export class CursorHarness implements Harness {
  readonly key = "cursor";
  readonly displayName = "Cursor";

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
      let content = entry.content;
      const isSkillFile = entry.category === "agent" ||
        entry.category === "skill" ||
        entry.category === "backlog-skill";
      if (isSkillFile) {
        content = ensureSkillFrontmatter(content, skillFolderName(entry));
      }
      addUnique(out, dest, {
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
