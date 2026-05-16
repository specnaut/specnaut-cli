# Architect agent memory — Specflow

Index of persistent notes for the `architect` subagent. Each line points to a
single-topic file in this directory.

Format: `- [Title](file.md) — one-line hook`

Keep the index under 200 lines. Prune entries that are no longer load-bearing
(drift items become obsolete once docs are fixed; old decisions become
obsolete once they are encoded in `AGENTS.md`).

## Entries

- [Antigravity Harness Research](antigravity-harness-research.md) — Canonical `.agent/` layout resolved from primary sources; resolves the .agent vs .agents ambiguity in issue #2
- [Claude plugin boundary](claude-plugin-boundary.md) — which templates go to the plugin vs stay binary-owned; the project-state rule
- [Claude plugin backwards compat](claude-plugin-compat.md) — state table + detection method for v0.x inline agents when plugin is installed
- [Router skill consolidation](router-skill-consolidation.md) — decisions for collapsing 11 specflow-* phase skills into a single /specflow router + phases/ subdirectory
- [Auto-chain disable-model-invocation fix](auto-chain-disable-model-invocation.md) — lift the flag from the router to unblock Skill-tool chaining by specflow-auto
- [Specflow-auto merge into router](specflow-auto-merge-into-router.md) — decisions for collapsing /specflow-auto chain logic into the /specflow router with --manual opt-out; deprecation alias + removal plan
- [SKILL.md frontmatter schema](skill-frontmatter-schema.md) — pass-through guarantee for new optional fields; no TypeScript changes needed for alias_of/overlays
