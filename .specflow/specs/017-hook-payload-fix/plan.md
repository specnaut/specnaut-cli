# Implementation Plan: Fix log-subagent hook payload extraction (#388)

**Branch**: `017-hook-payload-fix` | **Date**: 2026-06-13 | **Spec**: [spec.md](./spec.md)
**Input**: issue mkrlabs/specflow#388 (follow-up from epic mkrlabs/specflow-monorepo#12 dogfood)

## Summary

Correct three payload-extraction bugs in `templates/harness-specific/claude/hooks/log-subagent.sh`,
proven against the empirically-captured real Claude Code hook schema (research.md): (1) agent name ←
`agent_type`; (2) contract-block source ← `last_assistant_message`; (3) field greps ← canonical
UPPERCASE names (`STATE`/`DONE_CRITERIA_MET`/`HANDOFF_TARGET`/`REVIEW_VERDICT`/`QA_VERDICT`),
case-insensitive. Add optional `agent_id` + `effort` fields. Re-anchor the enrichment test to the real
payload shape (the original test agreed with the buggy hook, not reality). Update the ledger schema doc.

## Technical Context

**Language/Version**: bash + jq (hook); Deno/TS (test + bundle)
**Primary Dependencies**: none new
**Storage**: `.specflow/logs/agents.jsonl` (entry shape gains agent_id/effort + now-populated fields); `.specflow/logs/README.md` doc
**Testing**: hermetic hook test fed a REAL-shaped SubagentStop payload (agent_type + last_assistant_message + UPPERCASE block) + legacy-key + lowercase-field + start/no-block/jq-absent cases
**Project Type**: cli (no src/ code)
**Constraints**: preserve all prior invariants (jq -n JSON-safety, per-block segmentation, omit-if-absent, exit 0, jq-absent fallback, backward-compatible base line)
**Scale/Scope**: 1 hook edit + test fixture rewrite + schema-doc update + bundle regen

## Constitution Check
Placeholder constitution — no gate. Additive/corrective; ship through the bundle. **PASS.**

## Project Structure
```text
templates/harness-specific/claude/hooks/log-subagent.sh   # EDIT — agent_type, last_assistant_message, UPPERCASE -i greps, agent_id/effort
templates/core/specflow/logs/README.md                    # EDIT — document corrected key mapping + agent_id/effort
src/templates_bundle.ts                                    # REGENERATED
tests/templates/log_subagent_enrichment_test.ts           # EDIT — real-shape fixture + fallback/case cases
```

**Structure Decision**: Edit the hook in place (its manifest entry exists). The fix is localized to the
extraction block (lines ~22-30 agent/session; ~43-85 output/segment/field greps) + the JQ_ARGS assembly
to add agent_id/effort. No structural change to the segmentation or jq-composition design — those were
correct; only the keys and field-name patterns were wrong.

## Complexity Tracking
> No violations — empty.
