/**
 * Pure domain predicates for parent-managed detection.
 *
 * A *parent-managed* target is a sub-repo nested inside a providing Specnaut
 * workspace (an ancestor that owns the centralised skills/agents and declares
 * the target as a workspace member). In that state the toolkit (`.specnaut/`)
 * is still provisioned, but the agentic files (`.claude/skills|agents|commands`)
 * are inherited from the parent rather than written locally — any local copy is
 * the drift the centralised workspace deliberately eliminated.
 *
 * These functions are pure: all filesystem facts are passed in as arguments so
 * the domain layer never touches `Deno.*`.
 */

/**
 * Final detection decision for one target.
 *
 * The standalone override always wins over a positive detection (FR-008): a
 * user must be able to opt out of a coincidental directory layout without
 * surprise. Otherwise the target is parent-managed iff a providing ancestor
 * was found.
 *
 * @param providingAncestor canonical path of the first providing ancestor, or
 *   `null` when none exists.
 * @param standaloneOverride whether a `standalone.yml` marker forces the
 *   full standalone provisioning path.
 */
export function isParentManaged(
  providingAncestor: string | null,
  standaloneOverride: boolean,
): boolean {
  if (standaloneOverride) return false;
  return providingAncestor !== null;
}

/**
 * Whether a harness-mapped destination path is an *agentic* file — the set
 * suppressed for a parent-managed target.
 *
 * Operates on the already-harness-mapped destination string (not `CoreCategory`)
 * because the destination is the stable, harness-resolved truth: the same core
 * category maps to different paths under different harnesses. The predicate
 * never depends on repo identity (FR-010/FR-011).
 *
 * The prefix set is **claude-harness-only by design for this feature**: the
 * whole centralisation effort that motivates parent-managed detection is scoped
 * to `.claude/` (skills/agents/commands inherited from the providing
 * workspace). It does NOT match equivalent paths under other harnesses
 * (`.cursor/`, `.codex/`, `.opencode/`, …) — those are out of scope here and a
 * future reader should not assume they are suppressed. Within `.claude/`,
 * notably `.claude/settings.json`, `.claude/CLAUDE.md`, `AGENTS.md`,
 * `.gitignore`, and every `.specnaut/**` path are NOT agentic and are always
 * provisioned.
 */
export function isAgenticPath(dest: string): boolean {
  return dest.startsWith(".claude/skills/") ||
    dest.startsWith(".claude/agents/") ||
    dest.startsWith(".claude/commands/");
}
