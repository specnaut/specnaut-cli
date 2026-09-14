import { managedSectionField } from "./harness_managed.ts";
import type { BundleOptions, Harness } from "../../application/ports.ts";
import { HARNESS_STATIC } from "../../templates_bundle.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import { skillDocDestination, skillFolderName } from "./skill_folder.ts";
import { splitFrontmatter } from "./frontmatter.ts";
import { applyBackend, backlogScriptDestination } from "./backlog_filter.ts";
import { applyScheme, phaseScriptDestination } from "./scheme_filter.ts";
import { applySpecBackend } from "./spec_backend_filter.ts";
import { applySpecAutogen } from "./spec_autogen_filter.ts";
import { addUnique } from "./bundle_writer.ts";

function toCopilotInstructionMarkdown(entry: CoreEntry): string {
  const split = splitFrontmatter(entry.content);
  const body = split ? split.rest.replace(/^\n+/, "") : entry.content;
  return `---\napplyTo: "**"\n---\n\n${body}`;
}

function destinationFor(entry: CoreEntry): string {
  switch (entry.category) {
    case "agent":
    case "skill":
    case "backlog-skill":
      return `.github/instructions/${skillFolderName(entry)}.instructions.md`;
    case "backlog-doc":
    case "phase":
      // Copilot is flat too — a sibling instruction file, owner-prefixed.
      return skillDocDestination(entry, {
        kind: "flat",
        dir: ".github/instructions",
        ext: ".instructions.md",
      });
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

export class CopilotHarness implements Harness {
  readonly key = "copilot";
  readonly displayName = "GitHub Copilot CLI";

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
      const isInstruction = entry.category === "agent" ||
        entry.category === "skill" ||
        entry.category === "backlog-skill" ||
        entry.category === "phase";
      addUnique(out, dest, {
        content: isInstruction ? toCopilotInstructionMarkdown(entry) : entry.content,
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
