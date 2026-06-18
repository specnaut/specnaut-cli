# Contract: `/status-audit` report

Read-only. Reads `.specnaut/logs/agents.jsonl`; writes nothing.

## Required report sections

1. **Health** — count of agents per `state`.
2. **Per-agent** — each agent's latest `state`, verdict (`review_verdict`/`qa_verdict` if any), and
   last-update `ts`.
3. **Blocked** — agents whose latest state is `blocked` (call out as urgent).
4. **Stale** — non-terminal agents with no entry for ≥15 minutes.
5. **Contradictions** — agents with `state: done` but `done_criteria_met: no`.
6. **Missing handoffs** — agents with `handoff_target ≠ none` and no later entry for that target in
   the session.
7. **Verdict summary** — counts of `review_verdict` / `qa_verdict` across the session.

## Rules

- Absent ledger → "no ledger yet" (not an error).
- Malformed line → skipped with a note; valid lines still processed.
- Absent optional field → "unknown"; never an error.
- Current state for an agent = latest entry by `ts`.
- Read-only: `git status` unchanged after a run.

## Supervision pattern (documented in the SKILL.md)

```text
/loop 5m /status-audit      # health ping every 5 minutes during long headless work
```
