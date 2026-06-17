import type { BundleOptions, Harness } from "../../application/ports.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle, TemplateFile } from "../../domain/template.ts";
import { HARNESS_STATIC } from "../../templates_bundle.ts";
import { ensureSkillFrontmatter, skillFolderName } from "./skill_folder.ts";
import { applyBackend, backlogScriptDestination } from "./backlog_filter.ts";
import { applyScheme, phaseScriptDestination } from "./scheme_filter.ts";

function destinationFor(entry: CoreEntry): string {
  switch (entry.category) {
    case "backlog-cmd":
    case "agent":
    case "skill":
    case "backlog-skill":
      return `.cursor/skills/${skillFolderName(entry)}/SKILL.md`;
    case "phase":
      if (!entry.suffix) throw new Error(`phase needs suffix: ${entry.name}`);
      return `.cursor/skills/specnaut/phases/${entry.suffix}`;
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
      return `.specflow/${entry.suffix}`;
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
      const entry = applyScheme(backendApplied, opts);
      // agent-memory and the agent-fleet README are Claude-only conventions;
      // other harnesses skip them.
      if (entry.category === "agent-memory" || entry.category === "agent-doc") continue;
      const dest = destinationFor(entry);
      let content = entry.content;
      const isSkillFile = entry.category === "backlog-cmd" ||
        entry.category === "agent" ||
        entry.category === "skill" ||
        entry.category === "backlog-skill";
      if (isSkillFile) {
        content = ensureSkillFrontmatter(content, skillFolderName(entry));
      }
      out[dest] = {
        content,
        executable: entry.executable,
        ...(entry.category === "mergeable-project-root" ? { mergeBlock: "gitignore" } : {}),
        ...(entry.skipIfExists ? { skipIfExists: true as const } : {}),
      } satisfies TemplateFile;
    }
    const staticFiles = HARNESS_STATIC[this.key] ?? {};
    for (const [dest, file] of Object.entries(staticFiles)) {
      out[dest] = file;
    }
    return out;
  }
}
