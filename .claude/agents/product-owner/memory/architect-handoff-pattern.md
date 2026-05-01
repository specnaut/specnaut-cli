---
name: architect-handoff-pattern
description: How to handle issue promotion when the architect has already produced a design call — skip autonomous design, trust the spec, wire AC directly from it.
type: pattern
---

When the user dispatches "promote #N to Ready, architect's design is X", the workflow is:

1. Read the architect's design from the dispatch message AND from `.claude/agents/architect/memory/` for the relevant slug.
2. Do NOT re-derive the implementation strategy — the architect owns that. Wire AC bullets directly from the architect's stated behavior and file list.
3. Reference the architect's spec file (e.g. `docs/superpowers/specs/YYYY-MM-DD-slug.md`) in the Notes section so future readers can trace the design rationale.
4. List the concrete files the implementation must touch (as given by the architect) in Notes — this gives the implementing session a checklist without needing to re-read the design.
5. Out-of-scope bullets should echo what the architect explicitly ruled out, not what you infer.

**Why:** The architect's design call is the authoritative source. The PO's job at this stage is faithful transcription into testable AC + scoping guardrails, not independent design.

**How to apply:** AC bullets must be observable (exit codes, file content, SHA semantics, count of duplicates). Avoid AC that says "the implementation uses X approach" — say what the *user/test* observes, not how the code works.
