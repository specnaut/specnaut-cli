---
name: plugin-distribution
description: Canonical facts about the specflow-plugin Claude Code plugin — install command, slash-command namespace, what it contains, the three install paths, and the upgrade/check integration.
type: reference
---

## Plugin identity

- **Plugin name**: `specflow-plugin`
- **Manifest**: `plugin/.claude-plugin/plugin.json`
- **Versioning**: tracks `specflow` binary version (same as templates version); both were at `0.12.1` when the plugin shipped in v0.12.0/v0.12.1.
- **Homepage**: https://specflow.makerlabs.dev
- **Repo**: https://github.com/mkrlabs/specflow (the `plugin/` subtree is what the plugin registry sees as `mkrlabs/specflow-plugin`)

## Install command

```
/plugin install mkrlabs/specflow-plugin
```

This is the Claude Code marketplace UX. No binary needed.

## Slash-command namespace

Plugin skills are namespaced: `/specflow-plugin:specify`, `/specflow-plugin:plan`, etc.
Binary-scaffolded project copies use the short form: `/specify`, `/plan`, etc.

## What the plugin contains (21 assets)

- 10 specflow.* slash-command skills (`specify`, `plan`, `tasks`, `implement`, `analyze`, `review`, `merge`, `constitution`, `checklist`, `clarify`) — in `plugin/skills/`
- 1 auto-chain skill — `plugin/skills/auto-chain/SKILL.md`
- 1 groom skill — `plugin/skills/specflow-groom/SKILL.md`
- 9 sub-agents (`code-reviewer`, `developer`, `devops-sre`, `product-owner`, `qa-tester`, `review-coordinator`, `security-auditor`, `test-reviewer`, `workflow-manager`) — in `plugin/agents/`

**Not in the plugin** (binary-owned, project-stateful): backlog skill, backlog scripts, hooks, settings.json, CLAUDE.md, AGENTS.md, .specflow/ tree, architect agent.

## Three install paths

| Path | How | Scope | Slash-command style |
|------|-----|-------|---------------------|
| `/plugin install mkrlabs/specflow-plugin` | Claude Code marketplace | User-scope (all projects) | `/specflow-plugin:specify` |
| `specflow init` | Binary CLI | Project-scope (.claude/) | `/specify` |
| `claude --plugin-dir /path/to/specflow/plugin` | Local dev only | Session-scope | `/specflow-plugin:specify` |

## Plugin coverage predicate

`src/domain/plugin_coverage.ts` — `isPluginCoveredPath(harness, dest)`:
- Claude harness only.
- Covers: `.claude/agents/<name>.md` (all except `architect.md`) + `.claude/skills/specflow.*/SKILL.md` (10 files) + `.claude/skills/auto-chain/SKILL.md` + `.claude/skills/specflow-groom/SKILL.md`.
- Total: 21 covered paths (`PLUGIN_COVERED_PATHS_CLAUDE` array).

## upgrade-time migration behavior

When `specflow upgrade` runs AND harness is `claude` AND plugin is installed:
- **Vanilla file on disk** (SHA matches lock) → `migrate-to-plugin`: backed up + deleted from disk; plugin serves it going forward. File is dropped from the lock.
- **Customized file on disk** (SHA differs) → `preserve` with `pluginAvailable: true` flag; user sees `[plugin available — reconcile manually]` warning in upgrade output.
- **File already missing** (plugin owns it, nothing on disk) → `defer-to-plugin`: noted in plan, no action needed.

Plugin install detection: `src/infrastructure/fs_plugin_detector.ts` checks `~/.claude/plugins/cache/specflow-plugin/` existence via `Deno.stat`.

## check --project warn: "plugin gap"

`specflow check --project` runs `checkPluginGap`:
- Only for claude-harness projects.
- Only when plugin is NOT installed.
- For each of the 21 PLUGIN_COVERED_PATHS, if the file is missing on disk → warn:
  > "missing — restore via `specflow upgrade` or install the plugin (`/plugin install specflow-plugin`)"

This fires when a user previously ran `specflow upgrade` with the plugin installed (files got migrated away) and then uninstalled the plugin — the covered files are now silently absent.

## Known caveat (as of v0.12.1)

Handoff IDs in plugin skill SKILL.md files reference binary-scaffolded IDs (`specflow-plan`, etc.), not plugin-namespaced IDs (`specflow-plugin:plan`). Clickable handoff buttons may not resolve in plugin scope. Tracked in issue #73.
