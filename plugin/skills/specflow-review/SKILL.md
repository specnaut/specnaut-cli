---
name: specflow-review
description: Review the implementation against spec, plan, and tasks before merge — runs the quality gates (functional acceptance, test coverage, constitution checks). Auto-invokable when the user signals readiness to merge or asks for a final review pass.
when_to_use: |
  Trigger phrases:
  - "review the implementation"
  - "run quality gates"
  - "final review before merge"
  - "is this ready to ship?"
---

# Specflow review (auto-invoke alias)

This is a thin alias that exists solely so Claude Code can auto-invoke the review phase from natural-language prompts (the main `specflow` skill is `disable-model-invocation: true`).

When this skill fires, dispatch immediately to the router by reading and executing the procedure in `.claude/skills/specflow/phases/review.md`. Pass any `$ARGUMENTS` through unchanged.

Do not duplicate the review procedure here — it lives in `phases/review.md` and is the single source of truth.
