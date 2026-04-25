import type { Harness } from "../../application/ports.ts";
import type { CoreBundle, CoreEntry } from "../../domain/core_bundle.ts";
import type { Bundle, TemplateFile } from "../../domain/template.ts";
import { HARNESS_STATIC } from "../../templates_bundle.ts";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function cursorSkillName(entry: CoreEntry): string {
  switch (entry.category) {
    case "command":
      return `speckit-${entry.name}`;
    case "backlog-cmd":
      return `specflow-${entry.name}`;
    case "agent":
      return `specflow-agent-${entry.name}`;
    // Only one core skill exists today (the speckit auto-chain dispatcher).
    // If a second skill is ever added, this hardcoded mapping will collide — revisit then.
    case "skill":
      return `specflow-auto-chain`;
    default:
      throw new Error(`cursorSkillName not applicable for category: ${entry.category}`);
  }
}

function destinationFor(entry: CoreEntry): string {
  switch (entry.category) {
    case "command":
    case "backlog-cmd":
    case "agent":
    case "skill":
      return `.cursor/skills/${cursorSkillName(entry)}/SKILL.md`;
    case "spec-root":
      if (!entry.suffix) throw new Error(`spec-root needs suffix`);
      return `.specify/${entry.suffix}`;
    case "project-root":
      if (!entry.suffix) throw new Error(`project-root needs suffix`);
      return entry.suffix;
  }
}

function ensureSkillFrontmatter(content: string, skillName: string): string {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) {
    // No frontmatter → synthesize one
    return `---\nname: ${skillName}\ndescription: Specflow skill: ${skillName}\n---\n\n${content}`;
  }
  const fmBody = m[1];
  const rest = m[2];
  const hasName = /^name:\s/m.test(fmBody);
  const hasDescription = /^description:\s/m.test(fmBody);
  let newFm = fmBody;
  if (!hasName) newFm = `name: ${skillName}\n${newFm}`;
  if (!hasDescription) {
    newFm = `${newFm}\ndescription: Specflow skill: ${skillName}`;
  }
  return `---\n${newFm}\n---\n${rest}`;
}

export class CursorHarness implements Harness {
  readonly key = "cursor";
  readonly displayName = "Cursor";

  mapBundle(core: CoreBundle): Bundle {
    const out: Bundle = {};
    for (const entry of core) {
      const dest = destinationFor(entry);
      let content = entry.content;
      const isSkillFile = entry.category === "command" ||
        entry.category === "backlog-cmd" ||
        entry.category === "agent" ||
        entry.category === "skill";
      if (isSkillFile) {
        const skillName = cursorSkillName(entry);
        content = ensureSkillFrontmatter(content, skillName);
      }
      out[dest] = { content, executable: entry.executable } satisfies TemplateFile;
    }
    const staticFiles = HARNESS_STATIC[this.key] ?? {};
    for (const [dest, file] of Object.entries(staticFiles)) {
      out[dest] = file;
    }
    return out;
  }
}
