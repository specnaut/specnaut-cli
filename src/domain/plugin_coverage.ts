import type { KnownHarness } from "./installed_lock.ts";

/**
 * Pure predicate: does the `specnaut-plugin` plugin own a copy of the
 * file at `dest` (relative to the project root)?
 *
 * Used by the upgrade use case to decide whether to apply the binary →
 * plugin migration table for a given lock-tracked file. When the plugin
 * is installed AND a file is plugin-covered, the upgrade plan
 * branches:
 *
 *   - vanilla on disk (SHA matches lock) → `migrate-to-plugin`
 *   - customized on disk (SHA differs)   → `preserve` with
 *                                          `pluginAvailable: true`
 *
 * When the plugin is NOT installed, this predicate is irrelevant —
 * upgrade behavior is unchanged.
 *
 * Coverage is **Claude-harness only**. The plugin is Claude-specific;
 * Cursor/Codex/etc. projects keep their on-disk files binary-
 * owned regardless of plugin install state on the host machine.
 *
 * ## Membership criterion
 *
 * A destination is plugin-covered when three things hold:
 *
 *   1. the Claude adapter scaffolds it under `.claude/agents/` or
 *      `.claude/skills/`;
 *   2. the plugin ships the same content at the same path, with `.claude/`
 *      replaced by the plugin root;
 *   3. its content is **project-independent** — every path it names resolves
 *      from the project root rather than from the file's own location, nothing
 *      is rendered per project, and no user is expected to edit it as
 *      configuration.
 *
 * Coverage is all-or-nothing per skill: **claiming a skill claims every
 * document it owns.** A partially covered skill is the #455 shape with fewer
 * paths, and `plugin_coverage_parity_test.ts` fails one.
 *
 * Everything else stays binary-owned: `.specnaut/**` project state — including
 * `harness-tools.md`, which five harness-specific sources collapse into, so it
 * has no 1:1 plugin counterpart — plus harness-static files like
 * `.claude/settings.json`, hooks, `CLAUDE.md`, and the backlog scripts, which
 * resolve paths relative to their own location and so fail criterion 3.
 * `architect.md` is excluded as a contributor-only agent never bundled into
 * user projects.
 *
 * ## Membership has two teeth
 *
 * `upgrade` DELETES the on-disk copy of anything covered here when the plugin
 * is installed, and `check --project` reports it missing once the plugin is
 * uninstalled. Both are safe **only while every entry is still in
 * `CORE_BUNDLE`**: a covered path the bundle no longer ships cannot be restored
 * by `add-new`, so it becomes a permanent warning whose advice — "restore via
 * `specnaut upgrade`" — cannot be followed.
 *
 * **A phantom entry is the defect; breadth is not.** That distinction is what
 * #455 lacked. Its cost came from six paths the bundle had stopped shipping,
 * not from the list being wide, and conflating the two is what kept this list
 * narrow for three releases after the plugin outgrew it (specnaut-cli#605).
 */
export function isPluginCoveredPath(
  harness: KnownHarness,
  dest: string,
): boolean {
  if (harness !== "claude") return false;

  const agentMatch = dest.match(/^\.claude\/agents\/([^/]+)\.md$/);
  if (agentMatch !== null) return agentMatch[1] !== "architect";

  // Membership in the coverage list is the primary answer, and it is the only
  // branch that knows about owners other than `specnaut` — so it must come
  // first. Spec 033 put `/ship` alongside `/specnaut`; nothing below can see it.
  if (PLUGIN_COVERED_PATHS_CLAUDE.includes(dest)) return true;

  // LEGACY TOLERANCE, deliberately kept. These patterns accept any well-formed
  // `specnaut` path, including ones the bundle no longer ships — a stale lock
  // entry for a removed phase (`lite-heuristic`, say) still resolves here and
  // keeps its `migrate-to-plugin` treatment instead of becoming an orphan
  // removal. Replacing them with pure list membership would flip that, which
  // is a behaviour change wearing a cleanup's clothes.
  //
  // Whether the coverage list SHOULD be derived from the bundle rather than
  // hand-maintained is specnaut-cli#605, and it is deliberately unsettled:
  // the list names one skill while the plugin ships far more, so deriving it
  // would widen coverage as a side effect.
  //
  // Scoped to `specnaut` on purpose. These patterns accept paths the bundle
  // does not ship, so widening them to every owner would re-admit the phantom
  // entries the criterion above exists to keep out. Every other owner is
  // covered by list membership, which is checked against `CORE_BUNDLE`.
  if (dest === ".claude/skills/specnaut/SKILL.md") return true;
  if (/^\.claude\/skills\/specnaut\/phases\/[a-z]+(?:-[a-z]+)*\.md$/.test(dest)) {
    return true;
  }

  return false;
}

/**
 * The canonical list of project-relative paths the binary scaffolds for
 * the Claude harness AND the `specnaut-plugin` plugin owns. Used by
 * `check --project` to detect the "plugin uninstalled after migration"
 * gap: each path that is missing on disk AND for which the plugin is
 * not installed is a recoverable hole the user should know about
 * (either re-install the plugin or run `specnaut upgrade` to restore
 * the bundled snapshot).
 *
 * Kept in sync with `isPluginCoveredPath` above. **No count is written here.**
 * The comment used to claim "Total: 33 paths" against an array that held 38 —
 * a hand-maintained tally going stale inside the very comment documenting a
 * hand-maintained list going stale. The parity test counts; prose does not.
 *
 * This array is hand-written, and it drifted: #455 removed six phases and
 * added two, and only the *other* hand-written mirror (`SYNC_PAIRS` in the
 * plugin sync test) was updated. `specnaut check --project` reads this list,
 * so every correctly-migrated project was told six files were "missing —
 * restore via `specnaut upgrade`" — advice that cannot be followed, because
 * `upgrade` is what removes them.
 *
 * `tests/domain/plugin_coverage_parity_test.ts` now pins this array against
 * `CORE_BUNDLE`. Editing the manifest without editing this list turns that
 * test red, which is the only reason a third mirror is tolerable at all.
 *
 * Sub-document names may be hyphenated — the legacy regex was widened in #303
 * after it silently dropped three of them. The phase-1 audit family (`audit-security` #303,
 * `audit-performance` #304, `audit-accessibility` #305) shipped in
 * v1.9.0; the phase-2 family added `audit-architecture` (#321) and
 * `audit-dependencies` (#322) closing Epic #320. The lite-chain
 * heuristic (`lite-heuristic`, #346) ships under the same
 * `phases/` directory because it's bundled and synced through the
 * same channel, even though it's a contract doc rather than a phase.
 * `ui-ux-designer` was added alongside `architect-expert` in #321
 * to close a long-standing drift bug; this array continues to mirror
 * the bundled Claude scaffold exactly.
 */
/**
 * The plugin-root-relative path a covered destination corresponds to, or null.
 *
 * Criterion 2 of the membership rule — "the plugin ships the same content at
 * the same path with `.claude/` replaced by the plugin root" — expressed as a
 * function, so the probe that checks it cannot use a different rule than the
 * criterion that claims it.
 *
 * The mapping is 1:1 for exactly the two prefixes the criterion covers, which
 * is itself a reason coverage stops there. `.specnaut/harness-tools.md`, for
 * one, has five plugin sources and one destination — no path this could return
 * would be right.
 */
export function pluginRelativePath(dest: string): string | null {
  const PREFIX = ".claude/";
  return dest.startsWith(PREFIX) ? dest.slice(PREFIX.length) : null;
}

export const PLUGIN_COVERED_PATHS_CLAUDE: ReadonlyArray<string> = [
  // The agents' own index. `isPluginCoveredPath`'s agent regex has always
  // matched it (`README` !== `architect`), so `upgrade` would migrate it while
  // this list left `check --project` blind to it — the two consumers disagreeing
  // on a real file. Listing it makes them agree.
  ".claude/agents/README.md",
  ...[
    "code-reviewer",
    "developer",
    "devops-sre",
    "product-owner",
    "qa-tester",
    "review-coordinator",
    "security-expert",
    "specnaut-guide",
    "test-reviewer",
    "workflow-manager",
    "ui-ux-designer",
    "performance-expert",
    "accessibility-expert",
    "architect-expert",
    "dependency-expert",
  ].map((name) => `.claude/agents/${name}.md`),
  ".claude/skills/specnaut/SKILL.md",
  // The /ship skill (spec 033) — release concerns left /specnaut. Claiming a
  // skill means claiming all of its files: the parity test fails a skill that
  // is covered only in part.
  ".claude/skills/ship/SKILL.md",
  ".claude/skills/ship/phases/tag.md",
  ".claude/skills/ship/phases/release.md",
  ...[
    "plan",
    "plan-audits",
    "tasks",
    "implement",
    "epic-commits",
    "quality-gates",
    "epic-fixups",
    "merge-close",
    "epic-loop",
    "review",
    "merge",
    "merge-squash",
    "auto-chain",
    "constitution",
    "audit-security",
    "audit-performance",
    "audit-accessibility",
    "audit-architecture",
    "audit-dependencies",
  ].map((name) => `.claude/skills/specnaut/phases/${name}.md`),

  // `board` and its documents. Its `scripts/` subtree is NOT here and must not
  // be: those resolve paths relative to their own location, so they fail
  // criterion 3 — and they are not emitted under `.claude/skills/` at all, they
  // land in `.specnaut/scripts/backlog/`. The documents themselves name only
  // project-root-relative paths and are plugin-servable like any other.
  ".claude/skills/board/SKILL.md",
  ".claude/skills/board/groom.md",
  ".claude/skills/board/groom-report.md",
  ".claude/skills/board/spec-autogen.md",

  // Every remaining core skill, each owning exactly one document. They were
  // uncovered not by decision but by omission: the list was written when
  // `specnaut` was the only skill, and each of these joined the plugin without
  // anyone revisiting it (specnaut-cli#605).
  ...[
    "a11y-audit",
    "alert-triage-contract",
    "arch-audit",
    "backlog-frontmatter",
    "backlog-reference-contract",
    "brainstorming",
    "code-audit",
    "dep-audit",
    "executing-plans",
    "handoff-protocol",
    "mobile-first-contract",
    "perf-audit",
    "qa-report-contract",
    "requesting-code-review",
    "response-style-contract",
    "review-findings-contract",
    "sec-audit",
    "specnaut-facts",
    "status-audit",
    "subagent-driven-development",
    "using-specnaut",
    "verification-before-completion",
    "workflow-contract",
    "writing-plans",
  ].map((name) => `.claude/skills/${name}/SKILL.md`),
];
