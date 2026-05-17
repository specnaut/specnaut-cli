import type { KnownHarness } from "./installed_lock.ts";

/**
 * Pure predicate: does the `specflow-plugin` plugin own a copy of the
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
 * Cursor/Codex/Gemini/etc. projects keep their on-disk files binary-
 * owned regardless of plugin install state on the host machine.
 *
 * Coverage map (post-consolidation, v1.0.0):
 *
 *   - `.claude/agents/<name>.md` (excluding `architect.md` — that's a
 *     contributor-only agent, not bundled into user projects)
 *   - `.claude/skills/specflow/SKILL.md` — the consolidated router skill
 *   - `.claude/skills/specflow/phases/<phase>.md` — phase reference docs.
 *     Hyphenated names are valid (`tag-version`, `release-version`,
 *     `list-skills`, `audit-security`, …).
 *   - `.claude/skills/specflow-review/SKILL.md` — auto-invoke alias
 *   - `.claude/skills/specflow-auto/SKILL.md`
 *
 * Everything else (project-stateful files in `.specflow/`, harness-
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

  if (dest === ".claude/skills/specflow/SKILL.md") return true;
  // Hyphenated phase names are valid (`tag-version`, `release-version`,
  // `audit-security`, …). The earlier `[a-z]+` regex silently failed for
  // any phase containing a hyphen; the corrected pattern accepts one or
  // more lowercase alpha tokens separated by single hyphens.
  if (/^\.claude\/skills\/specflow\/phases\/[a-z]+(?:-[a-z]+)*\.md$/.test(dest)) {
    return true;
  }
  if (dest === ".claude/skills/specflow-review/SKILL.md") return true;
  if (dest === ".claude/skills/specflow-auto/SKILL.md") return true;

  return false;
}

/**
 * The canonical list of project-relative paths the binary scaffolds for
 * the Claude harness AND the `specflow-plugin` plugin owns. Used by
 * `check --project` to detect the "plugin uninstalled after migration"
 * gap: each path that is missing on disk AND for which the plugin is
 * not installed is a recoverable hole the user should know about
 * (either re-install the plugin or run `specflow upgrade` to restore
 * the bundled snapshot).
 *
 * Kept in sync with `isPluginCoveredPath` above. Total: 32 paths
 * (12 agents excluding architect + 1 router skill + 17 phase docs +
 * specflow-review alias + specflow-auto).
 *
 * Phase docs include hyphenated names — the regex was widened in #303
 * after silently dropping `tag-version`, `release-version`, and
 * `list-skills`. The audit family (`audit-security` #303,
 * `audit-performance` #304, `audit-accessibility` #305) is now
 * complete. `performance-auditor` (#304) and `a11y-auditor` (#305)
 * are the eleventh and twelfth bundled agents — both manual-only
 * (`disable-model-invocation: true`).
 */
export const PLUGIN_COVERED_PATHS_CLAUDE: ReadonlyArray<string> = [
  ...[
    "code-reviewer",
    "developer",
    "devops-sre",
    "product-owner",
    "qa-tester",
    "review-coordinator",
    "security-auditor",
    "specflow-expert",
    "test-reviewer",
    "workflow-manager",
    "performance-auditor",
    "a11y-auditor",
  ].map((name) => `.claude/agents/${name}.md`),
  ".claude/skills/specflow/SKILL.md",
  ...[
    "specify",
    "clarify",
    "plan",
    "tasks",
    "analyze",
    "implement",
    "review",
    "merge",
    "constitution",
    "checklist",
    "groom",
    "tag-version",
    "release-version",
    "list-skills",
    "audit-security",
    "audit-performance",
    "audit-accessibility",
  ].map((name) => `.claude/skills/specflow/phases/${name}.md`),
  ".claude/skills/specflow-review/SKILL.md",
  ".claude/skills/specflow-auto/SKILL.md",
];
