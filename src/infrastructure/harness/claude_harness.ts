import type { BundleOptions, Harness } from "../../application/ports.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import { HARNESS_STATIC } from "../../templates_bundle.ts";
import { applyBackend, backlogScriptDestination } from "./backlog_filter.ts";

function destinationFor(entry: CoreEntry): string {
  switch (entry.category) {
    case "command":
      return `.claude/commands/specflow.${entry.name}.md`;
    case "backlog-cmd":
      return `.claude/commands/${entry.name}.md`;
    case "agent":
      return `.claude/agents/${entry.name}.md`;
    case "agent-memory":
      if (!entry.suffix) throw new Error(`agent-memory needs suffix: ${entry.name}`);
      return `.claude/agents/${entry.name}/memory/${entry.suffix}`;
    case "skill":
    case "backlog-skill":
      return `.claude/skills/${entry.name}/SKILL.md`;
    case "backlog-script":
      return backlogScriptDestination(entry);
    case "spec-root":
      if (!entry.suffix) throw new Error(`spec-root entry needs suffix: ${entry.name}`);
      return `.specflow/${entry.suffix}`;
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
      const entry = applyBackend(raw, opts);
      if (entry === null) continue;
      out[destinationFor(entry)] = {
        content: entry.content,
        executable: entry.executable,
        ...(entry.category === "mergeable-project-root" ? { mergeBlock: "gitignore" } : {}),
      };
    }
    const staticFiles = HARNESS_STATIC[this.key] ?? {};
    for (const [dest, file] of Object.entries(staticFiles)) {
      out[dest] = file;
    }
    return out;
  }
}
