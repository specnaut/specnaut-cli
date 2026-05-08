---
name: router-skill-consolidation
description: Design decisions for consolidating 11 specflow-* phase skills into a single /specflow router skill
type: decision
---

**Rule: the consolidated skill layout is one SKILL.md router + 10-12 phase reference files in a `phases/` subdirectory within the same skill folder.**

Why: platform docs explicitly support supporting files in the skill directory; on-demand loading is more token-efficient than one monolithic SKILL.md; files remain project-local and user-customizable.

**How to apply:**
- Router lives at `.claude/skills/specflow/SKILL.md`
- Phase content lives at `.claude/skills/specflow/phases/<phase>.md`
- Router SKILL.md stays under 200 lines (dispatch table + one-liner index + "see phases/<phase>.md" pointers)
- `auto-chain` stays a separate skill (`.claude/skills/auto-chain/SKILL.md`) — body updated to reference `/specflow <phase>` instead of `/specflow-<phase>`
- Router uses `disable-model-invocation: true`; a thin stub at `.claude/skills/specflow-review/SKILL.md` (3 lines) preserves auto-invocation for the review phase only
- Handoffs in phase files use `agent: specflow` self-loop with phase-qualified prompt; test in live session before shipping — if self-loops fail, fall back to plain-text next-phase hints
- Plugin coverage: `isPluginCoveredPath` regex drops the `specflow-[a-z]+` pattern, replaced by exact match on `.claude/skills/specflow/SKILL.md` + glob for `.claude/skills/specflow/phases/*.md`
- Migration function `migrateSpecflowRouterSkill` follows the same pattern as `migrateLegacyDottedSkillFolders` in `src/cli/handlers/upgrade_handler.ts`; customized phase files are preserved by copying to `phases/<phase>.md` with a warning rather than overwriting
- Plugin namespace: accept `/specflow-plugin:specflow` double-prefix; plugin rename is a separate concern

Full design: `docs/superpowers/specs/2026-05-08-specflow-router-skill-design.md`
