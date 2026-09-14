import type { CoreCategory, CoreEntry } from "../../domain/core_bundle.ts";
import { splitFrontmatter } from "./frontmatter.ts";

/**
 * Returns the folder name for a skill-emitting core entry, used by harnesses that
 * render commands/agents/skills as skill folders (Cursor, Codex).
 */
export function skillFolderName(entry: CoreEntry): string {
  switch (entry.category) {
    case "skill":
    case "backlog-skill":
      // Skill names that already begin with "specnaut" are emitted as-is
      // (the router itself is "specnaut"; the auto-invoke alias is
      // "specnaut-review"). Other skills (`board`, …) get the namespacing
      // prefix to avoid clashes inside a global skills registry.
      return entry.name === "specnaut" || entry.name.startsWith("specnaut-")
        ? entry.name
        : `specnaut-${entry.name}`;
    case "agent":
      return `specnaut-agent-${entry.name}`;
    default:
      throw new Error(
        `skillFolderName not applicable for category: ${entry.category}`,
      );
  }
}

/**
 * The subdirectory a skill sub-document sits in, **as a property of the
 * category** rather than of its owner.
 *
 * `phase` and `backlog-doc` are the same thing — a document beside a skill,
 * loaded by that skill — and after the convergence they carry the same fields:
 * the owning skill in `name`, the document in `suffix`. The only thing that
 * ever distinguished them is this: a phase doc lives under `phases/`, a backlog
 * doc sits directly beside its `SKILL.md`.
 *
 * A category absent from this map has no subdirectory. Adding a sub-document
 * category means adding a row here, not a branch in seven adapters.
 */
const SKILL_DOC_SUBDIR: Partial<Record<CoreCategory, string>> = {
  phase: "phases",
};

/** Is this category a sub-document of a skill? */
export function isSkillDoc(category: CoreCategory): boolean {
  return category === "phase" || category === "backlog-doc";
}

/**
 * How a harness lays out a skill's sub-documents.
 *
 * `nested` harnesses give a skill its own folder, so the document goes inside
 * it. `flat` harnesses have one directory of files, so the document becomes a
 * sibling whose name carries its owner as a prefix.
 */
export type SkillDocShape =
  | {
    readonly kind: "nested";
    /** The skills root, e.g. `.claude/skills` — no trailing slash. */
    readonly root: string;
    /**
     * Whether the owner folder takes the `specnaut-` namespacing prefix.
     * Claude emits skill names verbatim; every other nested harness namespaces
     * them to avoid clashes in a global registry.
     */
    readonly namespaced: boolean;
  }
  | {
    readonly kind: "flat";
    /** The workflow/instruction directory, e.g. `.windsurf/workflows`. */
    readonly dir: string;
    /** Everything after the base name, e.g. `.md` or `.instructions.md`. */
    readonly ext: string;
  };

/**
 * **The single home for where a skill sub-document lands** (spec 033 §5).
 *
 * Nothing else may compose a `skills/<owner>/…` path. Before this existed the
 * rule was spelled fourteen times — a `phase` branch and a `backlog-doc` branch
 * in each of seven adapters — and the `phase` half hardcoded `specnaut` as the
 * owner, which is what made a second top-level skill with documents impossible
 * without touching all seven.
 */
export function skillDocDestination(entry: CoreEntry, shape: SkillDocShape): string {
  if (!isSkillDoc(entry.category)) {
    throw new Error(
      `skillDocDestination called on non-sub-document category: ${entry.category}`,
    );
  }
  if (!entry.suffix) {
    throw new Error(`${entry.category} needs suffix: ${entry.name}`);
  }
  const subdir = SKILL_DOC_SUBDIR[entry.category];

  if (shape.kind === "flat") {
    // Flat harnesses have no folders, so the subdirectory cannot be expressed
    // and is deliberately dropped: the owner prefix is what disambiguates.
    const owner = skillFolderName({ ...entry, category: "backlog-skill" });
    const base = entry.suffix.replace(/\.md$/, "");
    return `${shape.dir}/${owner}-${base}${shape.ext}`;
  }

  const owner = shape.namespaced
    ? skillFolderName({ ...entry, category: "backlog-skill" })
    : entry.name;
  return [shape.root, owner, subdir, entry.suffix].filter(Boolean).join("/");
}

/**
 * Injects `name:` and `description:` into a SKILL.md's frontmatter when missing.
 * Preserves any existing values. Used by every harness whose skill registry
 * requires these fields: Claude, Cursor, Codex, Antigravity and OpenCode.
 *
 * The fallback description is JSON-quoted because it contains `": "`, which a
 * plain YAML scalar may not. Emitting it bare produced frontmatter that every
 * parser rejects — and a registry that warns-and-skips on malformed frontmatter
 * drops the skill silently, so the guard failed more quietly than the condition
 * it guards against.
 */
function fallbackDescription(skillName: string): string {
  return JSON.stringify(`Specnaut skill: ${skillName}`);
}

export function ensureSkillFrontmatter(content: string, skillName: string): string {
  const split = splitFrontmatter(content);
  if (!split) {
    return `---\nname: ${skillName}\ndescription: ${
      fallbackDescription(skillName)
    }\n---\n\n${content}`;
  }
  const fmBody = split.fmBody;
  const rest = split.rest;
  const hasName = /^name:\s/m.test(fmBody);
  const hasDescription = /^description:\s/m.test(fmBody);
  let newFm = fmBody;
  if (!hasName) newFm = `name: ${skillName}\n${newFm}`;
  if (!hasDescription) {
    newFm = `${newFm}\ndescription: ${fallbackDescription(skillName)}`;
  }
  return `---\n${newFm}\n---\n${rest}`;
}
