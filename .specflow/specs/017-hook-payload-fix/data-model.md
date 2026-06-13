# Data Model — corrected ledger entry

## Entity: Ledger entry (append-only)
Base (unchanged): `ts`, `event`, `session`.
Corrected: `agent` ← `agent_type` (was always `unknown`).
New optional: `agent_id` (from `agent_id`), `effort` (from `effort.level`).
Now-populated optional (from `last_assistant_message`, matched on UPPERCASE canonical names,
case-insensitive, per block segment): `state`, `done_criteria_met`, `handoff_target`,
`review_verdict`, `qa_verdict`.

## Value object: PayloadKeys (the corrected extraction map)
- agentName: `.agent_type // .agent_name // .subagent_name // .tool_name // "unknown"`
- output:    `.last_assistant_message // .output // .result // .response // .tool_response // .message // (raw)`
- agent_id:  `.agent_id`  (optional)
- effort:    `.effort.level`  (optional)
- block fields: case-insensitive grep of `STATE:` / `DONE_CRITERIA_MET:` / `HANDOFF_TARGET:` (WORKFLOW segment), `REVIEW_VERDICT:` (REVIEW segment), `QA_VERDICT:` (QA segment)

## Invariants
- `agent` == `agent_type` when present (never `unknown` for a real dispatch).
- Optional keys omit-if-absent; base line always valid; exit 0 always; jq -n JSON-safe.
- `REVIEW_VERDICT`/`QA_VERDICT` parsed from their own segments (distinct names + segmentation).
