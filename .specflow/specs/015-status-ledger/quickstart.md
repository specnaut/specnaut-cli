# Quickstart — status ledger + `/status-audit`

## What ships

An enriched `log-subagent.sh` hook (captures contract fields into the JSONL ledger), a read-only
`/status-audit` skill (reports session health from the ledger), and a `.specnaut/logs/README.md`
schema doc. Plus the `/loop 5m /status-audit` supervision pattern.

## Build & test

```bash
cd apps/specflow-cli
deno task bundle
deno task test     # bundle + hook-enrichment hermetic test + status-audit content + schema-doc presence
```

## Manual verification

```bash
# hook enriches when a contract block is present
printf '{"session_id":"s1","agent_name":"security-auditor","output":"...\nREVIEW SUMMARY\nREVIEW_VERDICT: fail\nWORKFLOW STATUS\nSTATE: awaiting_review\nHANDOFF_TARGET: review-coordinator\n"}' \
  | bash templates/harness-specific/claude/hooks/log-subagent.sh stop
tail -1 .specnaut/logs/agents.jsonl   # → carries state/handoff_target/review_verdict

# backward-compatible when no block
printf '{"session_id":"s1","agent_name":"x"}' | bash …/log-subagent.sh stop
tail -1 .specnaut/logs/agents.jsonl   # → base four fields only, valid JSON

# skill + doc present
grep -q "/loop 5m /status-audit" templates/core/skills/status-audit/SKILL.md
test -f <bundled .specnaut/logs/README.md source>
```

## End-to-end

Run a few agents, then `/status-audit`: confirm per-state counts, blocked/stale flags, the
`done`+`done_criteria_met:no` contradiction, missing handoffs, and a verdict summary. `git status`
unchanged.

## Success signals

- `deno task test` green incl. the hook-enrichment + status-audit + schema-doc tests.
- Hook enriches when a block is present, stays backward-compatible otherwise, always exits 0.
- `/status-audit` reports the seven views and degrades gracefully on absent/dirty ledger.
- `specflow init`/`upgrade` deliver the enriched hook, the skill, and the schema doc.
