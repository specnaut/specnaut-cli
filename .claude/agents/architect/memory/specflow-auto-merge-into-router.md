---
name: specflow-auto-merge-into-router
description: Design decisions for merging specflow-auto chain logic into the /specflow router as the default, with --manual opt-out
type: decision
---

**Rule: merge specflow-auto chain-control logic into `specflow/SKILL.md` (the router). Auto-chain becomes the default for `/specflow specify`. `--manual` flag suppresses it. `specflow-auto/SKILL.md` becomes a one-release deprecation alias, then is removed from manifest.json.**

Why: two-skill structure is invisible to users who default to the shorter `/specflow specify`; agents recommend it without knowing they're missing the chain. The router already owns dispatch; chain semantics belong there.

**How to apply — router SKILL.md changes:**
- Add a pre-dispatch block in the router: parse `$ARGUMENTS` for `--manual` before extracting phase name. If `--manual` found, strip it and set chain-mode = false; default chain-mode = true.
- After executing the phase file for `specify`, if chain-mode = true: proceed through the auto-chain logic (the STOP #1 clarification checkpoint, silent gates, STOP #2 merge checkpoint) inline in the router body or via a new `phases/auto-chain.md` include.
- Mid-chain re-entry rule (artefact-detection default + `--continue` / `--once` overrides) moves into the router body for all non-specify phases.
- `--manual` is parsed at router level, NOT passed through to phase files.

**How to apply — specflow-auto/SKILL.md deprecation alias:**
- Body becomes: "This skill is deprecated since vX.Y. `/specflow` auto-chains by default. Run `/specflow <phase> <args>` directly. For one-shot use: `/specflow specify --manual \"<description>\"`."
- Do NOT use a Skill tool call from the alias body — it creates a dependency on the router for non-Claude harnesses that don't have the Skill tool. Plain prose redirect is sufficient (and the alias disappears in one release anyway).
- Remove from manifest.json and plugin/skills/specflow-auto/ in the release AFTER the deprecation release.

**Key implementation details confirmed from code search:**

1. Char cap: No harness enforces a char limit on SKILL.md bodies (only agents have the 12k Windsurf check). Merged router body at ~8-9k chars is safe.

2. `--manual` parsing location: MUST be at router level (SKILL.md), not inside phase files. Phase files receive `$ARGUMENTS` verbatim and treat it as feature description (specify.md) or artefact ID (plan.md etc). Stripping `--manual` before passing to the phase is the router's job.

3. analyze.md "Run /specflow plan" suggestion: under the merged router, a user acting on that suggestion in a context where downstream artefacts are absent WILL trigger chain behavior. This is actually desirable — that's the correct default. Document it as intentional in the phase file suggestion text (change to "Run `/specflow plan --once`" if the user only wants to regenerate plan, or `/specflow plan` to chain from there).

4. review.md line 84: currently says "hand back to /specflow-auto for STOP #2". After merge, change to "the router will present STOP #2 automatically" — the phrase "hand back to /specflow-auto" disappears.

5. Upgrade plan behavior: specflow-auto/SKILL.md has NO skipIfExists. Upgrade overwrites vanilla copies, preserves customized copies. When it becomes a deprecation alias, existing users get the alias on next upgrade (correct). When it is removed from manifest.json entirely, upgrade_plan.ts emits a `remove` action for users whose disk copy matches the lock SHA, and `preserve` for users who customized it. No orphan-file risk.

6. plugin_coverage.ts line 48 and line 94: must remove the specflow-auto entry from PLUGIN_COVERED_PATHS_CLAUDE and isPluginCoveredPath when the skill is removed. Keep it during the one-release deprecation window.

7. smoke-features.sh lines 205-211: currently asserts specflow-auto/SKILL.md has "Mid-chain re-entry", "--continue", "--once". After the merge these assertions must be MOVED to test the router SKILL.md instead. The specflow-auto block gets a single new assertion: "specflow-auto SKILL.md body contains deprecation notice".

**What is NOT needed:**
- No new port, no new adapter, no infrastructure change. This is purely template content + manifest.json + plugin/ mirror + plugin_coverage.ts.
- qa-tester/memory/MEMORY.md is an empty stub — no stale memories to fix.
- Product-owner, developer, review-coordinator, workflow-manager agents: none mention specflow-auto. Only specflow-expert.md (line 217) and cursor's specify-rules.mdc (line 32) need updating.

**Files requiring edits (exhaustive list):**
- `templates/core/skills/specflow/SKILL.md` — inline chain-control + --manual flag handling
- `templates/core/skills/specflow-auto/SKILL.md` — deprecation alias body
- `templates/core/skills/specflow/phases/review.md` — remove "hand back to /specflow-auto" (line 84)
- `templates/core/skills/specflow/phases/specify.md` — already reports "readiness for next phase"; no chain logic needed there (chain is driven by router after specify returns)
- `templates/core/agents/specflow-expert.md` line 217 — update to "/specflow specify auto-chains by default; /specflow-auto is deprecated"
- `templates/harness-specific/cursor/specify-rules.mdc` line 32 — remove /specflow-auto entry or mark deprecated
- `plugin/skills/specflow/SKILL.md` — mirror of router SKILL.md (byte-identical)
- `plugin/skills/specflow-auto/SKILL.md` — mirror of deprecation alias
- `plugin/skills/specflow/phases/review.md` — mirror
- `plugin/agents/specflow-expert.md` — mirror
- `plugin/README.md` — update description of specflow-auto
- `docs/llms.md` — rewrite auto-chain section (lines 358-413)
- `.claude/skills/test-sandbox/scripts/smoke-features.sh` — move specflow-auto assertions to router, add deprecation notice assertion
- `src/domain/plugin_coverage.ts` — keep specflow-auto during deprecation release, remove in next
- `templates/manifest.json` — keep specflow-auto entry during deprecation release

**Spec slug recommendation:** `docs/superpowers/specs/NNN-specflow-auto-merge.md`
