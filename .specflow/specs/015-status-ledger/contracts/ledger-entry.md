# Contract: enriched ledger entry (`.specflow/logs/agents.jsonl`)

One JSON object per line, appended by `log-subagent.sh` on each subagent start/stop.

## Backward-compatible base (always present)

```json
{
  "ts": "2026-06-13T11:00:00Z",
  "event": "stop",
  "session": "<id|unknown>",
  "agent": "<name|unknown>"
}
```

## Enriched (stop events whose payload carries a parseable contract block)

```json
{
  "ts": "…",
  "event": "stop",
  "session": "…",
  "agent": "security-auditor",
  "state": "awaiting_review",
  "done_criteria_met": "yes",
  "handoff_target": "review-coordinator",
  "review_verdict": "fail"
}
```

## Rules

- The four base fields are always present. The five contract fields (`state`, `done_criteria_met`,
  `handoff_target`, `review_verdict`, `qa_verdict`) are each OPTIONAL and present only when parsed
  from the agent output — never emitted empty.
- Allowed values per data-model.md. `handoff_target` may be `none`.
- The hook MUST exit 0 and append a valid line even when: no payload, no `jq`, no contract block, or
  unparseable output (→ base line only).
- The line MUST be valid JSON (parseable by a JSONL reader).
