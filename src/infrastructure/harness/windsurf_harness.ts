import type { Harness } from "../../application/ports.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import { skillFolderName } from "./skill_folder.ts";

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
    case "command":
    case "backlog-cmd":
    case "agent":
    case "skill":
      return `.windsurf/workflows/${skillFolderName(entry)}.md`;
    case "spec-root":
      if (!entry.suffix) throw new Error(`spec-root needs suffix`);
      return `.specflow/${entry.suffix}`;
    case "project-root":
      if (!entry.suffix) throw new Error(`project-root needs suffix`);
      return entry.suffix;
  }
}

export class WindsurfHarness implements Harness {
  readonly key = "windsurf";
  readonly displayName = "Windsurf";

  mapBundle(core: CoreBundle): Bundle {
    const out: Bundle = {};
    for (const entry of core) {
      out[destinationFor(entry)] = {
        content: entry.content,
        executable: entry.executable,
      };
    }
    return out;
  }
}
