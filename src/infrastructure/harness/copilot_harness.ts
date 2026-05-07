import type { BundleOptions, Harness } from "../../application/ports.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import { skillFolderName } from "./skill_folder.ts";
import { splitFrontmatter } from "./frontmatter.ts";
import { applyBackend, backlogScriptDestination } from "./backlog_filter.ts";

function toCopilotInstructionMarkdown(entry: CoreEntry): string {
  const split = splitFrontmatter(entry.content);
  const body = split ? split.rest.replace(/^\n+/, "") : entry.content;
  return `---\napplyTo: "**"\n---\n\n${body}`;
}

function destinationFor(entry: CoreEntry): string {
  switch (entry.category) {
    case "command":
    case "backlog-cmd":
    case "agent":
    case "skill":
    case "backlog-skill":
      return `.github/instructions/${skillFolderName(entry)}.instructions.md`;
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

export class CopilotHarness implements Harness {
  readonly key = "copilot";
  readonly displayName = "GitHub Copilot CLI";

  mapBundle(core: CoreBundle, opts: BundleOptions): Bundle {
    const out: Bundle = {};
    for (const raw of core) {
      const entry = applyBackend(raw, opts);
      if (entry === null) continue;
      // agent-memory is Claude-only (folder convention); other harnesses skip.
      if (entry.category === "agent-memory") continue;
      const dest = destinationFor(entry);
      const isInstruction = entry.category === "command" ||
        entry.category === "backlog-cmd" ||
        entry.category === "agent" ||
        entry.category === "skill" ||
        entry.category === "backlog-skill";
      out[dest] = {
        content: isInstruction ? toCopilotInstructionMarkdown(entry) : entry.content,
        executable: entry.executable,
        ...(entry.category === "mergeable-project-root" ? { mergeBlock: "gitignore" } : {}),
      };
    }
    return out;
  }
}
