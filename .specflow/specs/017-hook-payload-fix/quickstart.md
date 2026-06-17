# Quickstart — hook payload fix (#388)

## Build & test

```bash
cd apps/specflow-cli
deno task bundle
deno task test     # bundle + log_subagent_enrichment_test (real-shape fixture)
```

## Manual verification (real payload shape)

```bash
printf '{"session_id":"s1","agent_id":"a1","agent_type":"security-auditor","effort":{"level":"high"},"last_assistant_message":"...\nREVIEW SUMMARY\nREVIEW_VERDICT: fail\n"}' \
  | bash templates/harness-specific/claude/hooks/log-subagent.sh stop
tail -1 .specflow/logs/agents.jsonl
#   → agent:"security-auditor", agent_id:"a1", effort:"high", review_verdict:"fail"

# legacy/no-block still valid
printf '{"session_id":"s1","agent_type":"developer"}' | bash …/log-subagent.sh stop
tail -1 .specflow/logs/agents.jsonl   # → base + agent:"developer", valid JSON, exit 0
```

## Success signals

- Real-shape fixture → `agent` populated from `agent_type` + `review_verdict` captured.
- `agent_id`/`effort` present when in the payload; absent → omitted.
- Legacy-key + lowercase-field fallbacks work; start/no-block/jq-absent → valid base line, exit 0.
- `deno task test` green; schema doc updated.
