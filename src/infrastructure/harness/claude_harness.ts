import type { Harness } from "../../application/ports.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import { HARNESS_STATIC } from "../../templates_bundle.ts";

function destinationFor(entry: CoreEntry): string {
  switch (entry.category) {
    case "command":
      return `.claude/commands/speckit.${entry.name}.md`;
    case "backlog-cmd":
      return `.claude/commands/${entry.name}.md`;
    case "agent":
      return `.claude/agents/${entry.name}.md`;
    case "skill":
      return `.claude/skills/${entry.name}/SKILL.md`;
    case "spec-root":
      if (!entry.suffix) throw new Error(`spec-root entry needs suffix: ${entry.name}`);
      return `.specify/${entry.suffix}`;
    case "project-root":
      if (!entry.suffix) throw new Error(`project-root entry needs suffix: ${entry.name}`);
      return entry.suffix;
  }
}

export class ClaudeHarness implements Harness {
  readonly key = "claude";
  readonly displayName = "Claude Code";

  mapBundle(core: CoreBundle): Bundle {
    const out: Bundle = {};
    for (const entry of core) {
      out[destinationFor(entry)] = {
        content: entry.content,
        executable: entry.executable,
      };
    }
    const staticFiles = HARNESS_STATIC[this.key] ?? {};
    for (const [dest, file] of Object.entries(staticFiles)) {
      out[dest] = file;
    }
    return out;
  }
}
