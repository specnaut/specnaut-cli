import type { BundleOptions, Harness } from "../../application/ports.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle } from "../../domain/template.ts";
import { HARNESS_STATIC } from "../../templates_bundle.ts";
import { applyBackend, backlogScriptDestination } from "./backlog_filter.ts";
import { ensureSkillFrontmatter, skillFolderName } from "./skill_folder.ts";

function destinationFor(entry: CoreEntry): string {
  switch (entry.category) {
    case "command":
      // Claude harness uses skill-folder format for specflow-* commands
      // (per the modern Claude Code convention — flat command files are
      // deprecated). The folder name uses a hyphen separator because
      // Claude Code's runtime validator rejects dots in skill names
      // (`Skill name may only contain lowercase letters, numbers, and
      // hyphens`). `skillFolderName` is the shared helper the other
      // harnesses already use — claude was the only outlier.
      return `.claude/skills/${skillFolderName(entry)}/SKILL.md`;
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

      // Skill-folder categories ship as `.claude/skills/<name>/SKILL.md`.
      // Claude Code derives the skill name from the folder, but we inject
      // an explicit `name:` (matching the folder) for parity with how
      // cursor / codex / gemini emit their skill folders. This also
      // guarantees the SKILL.md self-identifies if Claude Code's resolver
      // ever requires it.
      let content = entry.content;
      if (entry.category === "command") {
        content = ensureSkillFrontmatter(content, skillFolderName(entry));
      } else if (entry.category === "skill" || entry.category === "backlog-skill") {
        content = ensureSkillFrontmatter(content, entry.name);
      }

      out[destinationFor(entry)] = {
        content,
        executable: entry.executable,
        ...(entry.category === "mergeable-project-root" ? { mergeBlock: "gitignore" } : {}),
        ...(entry.skipIfExists ? { skipIfExists: true as const } : {}),
      };
    }
    const staticFiles = HARNESS_STATIC[this.key] ?? {};
    for (const [dest, file] of Object.entries(staticFiles)) {
      out[dest] = file;
    }
    return out;
  }
}
