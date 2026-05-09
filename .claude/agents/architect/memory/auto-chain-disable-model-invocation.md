---
name: auto-chain-disable-model-invocation
description: Why disable-model-invocation must be lifted from /specflow router to allow /specflow-auto Skill-tool chaining, and what the safe path is
type: decision
---

**Rule: lift `disable-model-invocation: true` from `templates/core/skills/specflow/SKILL.md`. The flag blocks the `Skill` tool call that `specflow-auto` depends on.**

Why: The original rationale (design spec Q1) was "prevent spurious auto-spawn on casual mention." That goal is still met by keeping the flag on `specflow-review` alias and leaving `specflow-auto` as the explicit entry point. The risk of auto-spawn from lifting the flag is low because the `when_to_use` trigger phrases are specific ("spec out a feature", "write a spec", etc.) — they don't fire on casual mention of "specflow."

**How to apply:**
- Remove `disable-model-invocation: true` from line 3 of `templates/core/skills/specflow/SKILL.md`
- Flip the smoke assertion at `.claude/skills/test-sandbox/scripts/smoke-features.sh:63-64` from "grep for `disable-model-invocation: true`" to "assert `disable-model-invocation` is absent (or false) on the router"
- The `specflow-review` alias (auto-invoke surface for the review phase) is unaffected — it already has no `disable-model-invocation` flag
- `disable-model-invocation` is a Claude Code-only runtime concept; the other 6 harnesses (cursor, codex, copilot, gemini, windsurf, opencode) copy the file verbatim and ignore the flag — the bug only manifests on Claude Code
- Do NOT do option 2 (bypass router from specflow-auto) — it would duplicate routing logic and break the clean phase-doc pattern
