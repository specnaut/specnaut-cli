import type { CoreEntry } from "../../domain/core_bundle.ts";
import { splitFrontmatter } from "./frontmatter.ts";

/**
 * Returns the folder name for a skill-emitting core entry, used by harnesses that
 * render commands/agents/skills as skill folders (Cursor, Codex).
 */
export function skillFolderName(entry: CoreEntry): string {
  switch (entry.category) {
    case "backlog-cmd":
      return `specflow-${entry.name}`;
    case "skill":
    case "backlog-skill":
      // Skill names that already begin with "specflow" are emitted as-is
      // (the router itself is "specflow"; the auto-invoke alias is
      // "specflow-review"; "specflow-auto" is the deprecated alias). Other
      // skills (`backlog`, …) get the namespacing prefix to avoid
      // clashes inside a global skills registry.
      return entry.name === "specflow" || entry.name.startsWith("specflow-")
        ? entry.name
        : `specflow-${entry.name}`;
    case "agent":
      return `specflow-agent-${entry.name}`;
    default:
      throw new Error(
        `skillFolderName not applicable for category: ${entry.category}`,
      );
  }
}

/**
 * Injects `name:` and `description:` into a SKILL.md's frontmatter when missing.
 * Preserves any existing values. Used by harnesses whose skill registries require
 * these fields (Cursor, Codex).
 */
export function ensureSkillFrontmatter(content: string, skillName: string): string {
  const split = splitFrontmatter(content);
  if (!split) {
    return `---\nname: ${skillName}\ndescription: Specflow skill: ${skillName}\n---\n\n${content}`;
  }
  const fmBody = split.fmBody;
  const rest = split.rest;
  const hasName = /^name:\s/m.test(fmBody);
  const hasDescription = /^description:\s/m.test(fmBody);
  let newFm = fmBody;
  if (!hasName) newFm = `name: ${skillName}\n${newFm}`;
  if (!hasDescription) {
    newFm = `${newFm}\ndescription: Specflow skill: ${skillName}`;
  }
  return `---\n${newFm}\n---\n${rest}`;
}
