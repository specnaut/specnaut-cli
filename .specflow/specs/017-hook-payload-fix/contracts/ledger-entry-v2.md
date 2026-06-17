# Contract: corrected ledger entry

## Base (always)

```json
{ "ts": "…", "event": "start|stop", "session": "<id|unknown>", "agent": "<agent_type|unknown>" }
```

## Enriched (stop, when last_assistant_message carries a contract block)

```json
{
  "ts": "…",
  "event": "stop",
  "session": "…",
  "agent": "security-auditor",
  "agent_id": "abf05f10d169e18fa",
  "effort": "high",
  "state": "awaiting_review",
  "done_criteria_met": "yes",
  "handoff_target": "review-coordinator",
  "review_verdict": "fail"
}
```

## Rules

- `agent` from `agent_type` (fallbacks `agent_name`/`subagent_name`/`tool_name`/`unknown`).
- Contract-block source: `last_assistant_message` (fallbacks
  `output`/`result`/`response`/`tool_response`/`message`/raw).
- `agent_id`, `effort` optional (omit-if-absent).
- Block fields matched against canonical UPPERCASE names case-insensitively;
  `review_verdict`/`qa_verdict` from their own block segments.
- jq -n composition (JSON-safe); always exit 0; jq-absent → base line; start event → base line.
