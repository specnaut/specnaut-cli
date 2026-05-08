import type { BundleOptions, Harness } from "../../application/ports.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import { skillFolderName } from "./skill_folder.ts";
import { applyBackend, backlogScriptDestination } from "./backlog_filter.ts";

/**
 * Windsurf's per-workflow character cap. Cascade silently truncates at this
 * boundary, so we hard-fail at test time when any emitted workflow would
 * exceed it.
 *
 * Documented at https://docs.windsurf.com/windsurf/cascade/workflows
 */
export const WINDSURF_WORKFLOW_MAX_CHARS = 12_000;

function destinationFor(entry: CoreEntry): string {
  switch (entry.category) {
    case "backlog-cmd":
    case "agent":
    case "skill":
    case "backlog-skill":
      return `.windsurf/workflows/${skillFolderName(entry)}.md`;
    case "phase":
      // Windsurf is flat — no nested skill folders. Each phase doc
      // becomes a sibling workflow file the router references by name.
      if (!entry.suffix) throw new Error(`phase needs suffix: ${entry.name}`);
      return `.windsurf/workflows/specflow-${entry.suffix.replace(/\.md$/, "")}.md`;
    case "backlog-script":
      return backlogScriptDestination(entry);
    case "agent-memory":
      throw new Error("agent-memory entries should be filtered before destinationFor");
    case "spec-root":
      if (!entry.suffix) throw new Error(`spec-root needs suffix`);
      return `.specflow/${entry.suffix}`;
    case "project-root":
    case "mergeable-project-root":
      if (!entry.suffix) throw new Error(`${entry.category} needs suffix`);
      return entry.suffix;
  }
}

export class WindsurfHarness implements Harness {
  readonly key = "windsurf";
  readonly displayName = "Windsurf";

  mapBundle(core: CoreBundle, opts: BundleOptions): Bundle {
    const out: Bundle = {};
    for (const raw of core) {
      const entry = applyBackend(raw, opts);
      if (entry === null) continue;
      // agent-memory is Claude-only (folder convention); other harnesses skip.
      if (entry.category === "agent-memory") continue;
      out[destinationFor(entry)] = {
        content: entry.content,
        executable: entry.executable,
        ...(entry.category === "mergeable-project-root" ? { mergeBlock: "gitignore" } : {}),
        ...(entry.skipIfExists ? { skipIfExists: true as const } : {}),
      };
    }
    return out;
  }
}
