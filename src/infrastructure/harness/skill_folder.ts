import type { CoreEntry } from "../../domain/core_bundle.ts";

/**
 * Returns the folder name for a skill-emitting core entry, used by harnesses that
 * render commands/agents/skills as skill folders (Cursor, Codex).
 */
export function skillFolderName(entry: CoreEntry): string {
  switch (entry.category) {
    case "command":
    case "backlog-cmd":
    case "skill":
      return `specflow-${entry.name}`;
    case "agent":
      return `specflow-agent-${entry.name}`;
    default:
      throw new Error(
        `skillFolderName not applicable for category: ${entry.category}`,
      );
  }
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

/**
 * Injects `name:` and `description:` into a SKILL.md's frontmatter when missing.
 * Preserves any existing values. Used by harnesses whose skill registries require
 * these fields (Cursor, Codex).
 */
export function ensureSkillFrontmatter(content: string, skillName: string): string {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) {
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
