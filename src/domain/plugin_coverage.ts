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
 * Coverage map:
 *
 *   - `.claude/agents/<name>.md` (excluding `architect.md` — that's a
 *     contributor-only agent, not bundled into user projects)
 *   - `.claude/skills/<owner>/SKILL.md` for the skills the list claims, and
 *     every sub-document those skills own. **Claiming a skill claims all of
 *     it**: a partially covered skill is the #455 shape with fewer paths, and
 *     `plugin_coverage_parity_test.ts` fails one.
 *
 * The list names **two** owners — `specnaut` and `ship` (spec 033, which moved
 * release concerns out of the router). It does NOT name every skill the plugin
 * ships; whether it should is specnaut-cli#605, deliberately unsettled, because
 * widening it changes what `check --project` reports and what `upgrade`
 * migrates. The parity test pins the owner set so neither can drift by
 * accident.
 *
 * Everything else (project-stateful files in `.specnaut/`, harness-
 * static files like `.claude/settings.json`, hooks, `CLAUDE.md`,
 * backlog scripts) stays binary-owned and is NOT covered.
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
 * Kept in sync with `isPluginCoveredPath` above. Total: 33 paths
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
export const PLUGIN_COVERED_PATHS_CLAUDE: ReadonlyArray<string> = [
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
];
