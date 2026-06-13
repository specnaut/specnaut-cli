# Tasks: Fix log-subagent hook payload extraction (#388)

**Feature**: `017-hook-payload-fix` | **Branch**: `017-hook-payload-fix` | **Issue**: mkrlabs/specflow#388
**Inputs**: [spec.md](./spec.md) · [research.md](./research.md) (captured real payload) · [plan.md](./plan.md) · contracts/ledger-entry-v2.md

TDD: re-anchor the test to the REAL payload first (it FAILS against the current hook — proving the bug),
then fix the hook to green.

## Phase 1: Test re-anchoring (RED)
- [ ] T001 Rewrite/extend `tests/templates/log_subagent_enrichment_test.ts` so the primary enrichment
      case feeds a REAL-shaped `SubagentStop` payload: `{session_id, agent_id, agent_type:"security-auditor",
      effort:{level:"high"}, last_assistant_message:"…\nREVIEW SUMMARY\nREVIEW_VERDICT: fail\nWORKFLOW STATUS\nSTATE: awaiting_review\nHANDOFF_TARGET: review-coordinator\n"}` and assert `agent==="security-auditor"`,
      `agent_id==="…"`, `effort==="high"`, `review_verdict==="fail"`, `state==="awaiting_review"`,
      `handoff_target==="review-coordinator"`. Add: a legacy-`.output`-key case; a lowercase-field case
      (`review_verdict: pass`) asserting it's still captured; the dual-block (REVIEW fail + QA pass) case
      using UPPERCASE `REVIEW_VERDICT`/`QA_VERDICT`; keep the JSON-injection + start + no-block + jq cases.
      Confirm the new real-shape assertions FAIL against the current hook.

## Phase 2: Fix the hook (GREEN)
- [ ] T002 Edit `templates/harness-specific/claude/hooks/log-subagent.sh`:
      (a) AGENT ← `jq -r '.agent_type // .agent_name // .subagent_name // .tool_name // "unknown"'`.
      (b) AGENT_ID ← `jq -r '.agent_id // ""'`; EFFORT ← `jq -r '.effort.level // ""'`.
      (c) OUTPUT ← `jq -r '.last_assistant_message // .output // .result // .response // .tool_response // .message // ""'` (fallback to raw if empty).
      (d) Field greps → canonical UPPERCASE names, case-insensitive: `grep -ioE 'STATE:[[:space:]]*[a-z_]+'`,
          `'DONE_CRITERIA_MET:[[:space:]]*(yes|no)'`, `'HANDOFF_TARGET:[[:space:]]*[A-Za-z0-9_-]+'`,
          `'REVIEW_VERDICT:[[:space:]]*(pass|fail|needs_followup)'` (REVIEW seg), `'QA_VERDICT:[[:space:]]*(pass|fail|blocked)'` (QA seg);
          strip the field-name prefix case-insensitively. Update the segment() awk headers are already UPPERCASE (correct) — leave.
      (e) Add `agent_id`/`effort` to the JQ_ARGS/JQ_FILTER assembly as omit-if-absent optional keys (same pattern as state/etc.).
      Preserve: `set -euo pipefail`, jq -n composition, per-block segmentation, exit 0, jq-absent base-line fallback.
- [ ] T003 `shellcheck` the hook clean; confirm T001 now GREEN.

## Phase 3: Docs + distribution
- [ ] T004 Update `templates/core/specflow/logs/README.md`: `agent` ← `agent_type`; block source ← `last_assistant_message`; new optional `agent_id`/`effort` fields; canonical UPPERCASE field names.
- [ ] T005 `deno task bundle`; confirm the fixed hook is embedded in `src/templates_bundle.ts`. (Hook is harness-specific, not plugin-mirrored — no plugin change. No new skill folder — init counts unchanged.)

## Phase 4: Validate
- [ ] T006 `deno task test` GREEN; `deno fmt`+`deno lint` on the test; manual: pipe the real-shape + legacy + no-block payloads, confirm the JSONL lines per quickstart.md.

## Dependencies
- T001 (RED) → T002 (GREEN) → T003. T004 parallel. T005 after T002. T006 last.
