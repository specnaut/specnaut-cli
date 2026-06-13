# Implementation Plan: Structured status ledger + `/status-audit` + `/loop` supervision

**Branch**: `015-status-ledger` | **Date**: 2026-06-13 | **Spec**: [spec.md](./spec.md)
**Input**: issue mkrlabs/specflow#381, epic mkrlabs/specflow-monorepo#12

## Summary

Three additive surfaces, all reading the mechanism-A (#378) contract blocks:
1. **Enrich** `templates/harness-specific/claude/hooks/log-subagent.sh` to parse contract fields
   (`state`, `done_criteria_met`, `handoff_target`, `review_verdict`, `qa_verdict`) from the stop-event
   payload's agent output (best-effort, jq) and append them as OPTIONAL JSONL fields beside the existing
   `{ts, event, session, agent}` — backward-compatible, omit-if-absent, always exit 0.
2. **Add** a `/status-audit` markdown skill (`templates/core/skills/status-audit/SKILL.md`) that reads
   `.specflow/logs/agents.jsonl` and reports the seven health views; documents `/loop 5m /status-audit`.
3. **Document** the enriched ledger schema in a bundled `.specflow/logs/README.md`.

The testable core is the hook (hermetic: feed payload → assert JSONL fields). `/status-audit` is a
read+reason skill (content-tested). No src/ runtime code.

## Technical Context

**Language/Version**: bash + jq (hook); markdown (skill + schema doc); Deno/TS for tests/bundle
**Primary Dependencies**: none new — existing bundle pipeline; `jq` already used (optionally) by the hook
**Storage**: the existing append-only `.specflow/logs/agents.jsonl`; a new `.specflow/logs/README.md` (schema doc)
**Testing**: hermetic hook test — pipe a synthetic stop-event payload (with/without a contract block, with/without jq on PATH) into `log-subagent.sh` against a temp `.specflow/logs/`, assert the appended line's shape; skill-content test for `/status-audit` (seven views + supervision pattern documented); schema-doc presence
**Target Platform**: the Specflow CLI; artifacts land in any project's `.claude/` + `.specflow/logs/`
**Project Type**: cli (no src/ change)
**Performance Goals**: N/A
**Constraints**: hook never breaks a dispatch (exit 0 always); backward-compatible line shape; read-only skill
**Scale/Scope**: 1 hook edit + 1 skill + 1 schema doc + manifest/bundle/plugin wiring + ~2 tests

## Constitution Check

Placeholder constitution — no gate. De-facto: hook is additive + degrades gracefully; skill read-only;
ship through the bundle. **PASS.**

## Project Structure

```text
templates/harness-specific/claude/hooks/log-subagent.sh   # EDIT — parse + append optional contract fields
templates/core/skills/status-audit/SKILL.md               # NEW — read ledger, report 7 views, /loop pattern
templates/core/skills/status-audit/...                    # markdown-only (mirror to plugin/)
templates/<bundled .specflow/logs/README.md source>       # NEW — ledger schema doc (per manifest convention)
templates/manifest.json                                    # EDIT — register the skill + the README doc
src/templates_bundle.ts                                    # REGENERATED
plugin/skills/status-audit/SKILL.md                        # NEW mirror (markdown-only)
tests/                                                      # NEW — hook-enrichment hermetic test + skill-content + schema-doc presence
```

**Structure Decision**: The hook is an existing harness-specific claude file — edit in place; its
manifest entry already exists (no new registration for the hook). The schema doc ships as a bundled
file under `.specflow/logs/` — register it in the manifest following how other non-skill bundled files
are listed (check an existing `.specflow/`-destined entry). `/status-audit` is markdown-only → mirror to
`plugin/`. Determine where to author the schema-doc source in the template tree from the manifest's
existing `.specflow/`-target entries.

## Complexity Tracking

> No violations — empty.
