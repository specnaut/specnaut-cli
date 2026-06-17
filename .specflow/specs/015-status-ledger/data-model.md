# Data Model — status ledger + `/status-audit`

No DB. The model is the JSONL entry schema and the derived health view.

## Entity: Ledger entry (append-only)

Identity = `(session, agent, ts, event)`. One JSON object per line in `.specflow/logs/agents.jsonl`.

Required (existing, unchanged):

- `ts` — UTC ISO-8601 string
- `event` — `start` | `stop`
- `session` — string (or `unknown`)
- `agent` — string (or `unknown`)

Optional (new, omit-if-absent):

- `state` — `in_progress|blocked|awaiting_review|awaiting_qa|awaiting_user|done|failed`
- `done_criteria_met` — `yes|no`
- `handoff_target` — agent name | `none`
- `review_verdict` — `pass|fail|needs_followup`
- `qa_verdict` — `pass|fail|blocked`

A line never contains an optional key with an empty/garbage value — absent means omitted.

## Value object: ContractFields(state?, done_criteria_met?, handoff_target?, review_verdict?, qa_verdict?)

Parsed by the hook from the agent output's contract blocks (#378). All optional.

## Value object: SessionHealth (derived by `/status-audit`, read-only)

- `stateCounts` — map state → count
- `perAgentLatest` — agent → (state, verdict, last `ts`) [latest entry by `ts`]
- `blocked` — agents whose latest state is `blocked`
- `stale` — non-terminal agents with no entry for ≥15 min
- `contradictions` — agents with `state == done` ∧ `done_criteria_met == no`
- `missingHandoffs` — agents with `handoff_target ≠ none` and no later entry for that target
- `verdictSummary` — counts of `review_verdict` / `qa_verdict` across the session

## Invariants

- Append-only ledger; hook always exits 0 (never breaks a dispatch).
- Optional fields omit-if-absent; original four-field lines stay valid.
- Current state of an agent = its latest entry by `ts`.
- `/status-audit` is read-only and degrades gracefully (absent ledger / malformed line / absent
  fields → "unknown", never error).
