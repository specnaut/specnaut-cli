# Status ledger — `.specflow/logs/agents.jsonl`

This directory holds the **append-only status ledger** written by the
`log-subagent.sh` hook on every subagent start/stop. Each subagent event
appends **one JSON object per line** (JSONL) to `agents.jsonl`. The
`/status-audit` skill reads this file to report session health.

The ledger is **append-only** and the hook **always exits 0** — logging never
breaks a dispatch. A line is never rewritten; an agent's *current* state is its
**latest entry by `ts`**.

## Line schema

### Base fields (always present)

| Field     | Type                | Notes                                         |
| --------- | ------------------- | --------------------------------------------- |
| `ts`      | string (ISO-8601)   | UTC timestamp, e.g. `2026-06-13T11:00:00Z`.   |
| `event`   | string              | `start` or `stop`.                            |
| `session` | string              | Session id, or `unknown` if absent.           |
| `agent`   | string              | Subagent name, or `unknown` if absent.        |

### Contract fields (optional — omit-if-absent)

Parsed from the subagent's output text on **`stop`** events when it carries the
machine-readable contract blocks (`WORKFLOW STATUS` / `REVIEW SUMMARY` /
`QA SUMMARY`). Each key is present **only** when parsed — never emitted empty,
never with a garbage value. An absent key means the field was not present in the
output.

| Field               | Type   | Source block      | Allowed values                                                                  |
| ------------------- | ------ | ----------------- | ------------------------------------------------------------------------------- |
| `state`             | string | `WORKFLOW STATUS` | `in_progress` · `blocked` · `awaiting_review` · `awaiting_qa` · `awaiting_user` · `done` · `failed` |
| `done_criteria_met` | string | `WORKFLOW STATUS` | `yes` · `no`                                                                    |
| `handoff_target`    | string | `WORKFLOW STATUS` | an agent name, or `none`                                                        |
| `review_verdict`    | string | `REVIEW SUMMARY`  | `pass` · `fail` · `needs_followup`                                              |
| `qa_verdict`        | string | `QA SUMMARY`      | `pass` · `fail` · `blocked`                                                     |

## Examples

Base line (no contract block parsed, or a `start` event):

```json
{"ts":"2026-06-13T11:00:00Z","event":"start","session":"sess-123","agent":"developer"}
```

Enriched `stop` line (contract block parsed from the output):

```json
{"ts":"2026-06-13T11:42:00Z","event":"stop","session":"sess-123","agent":"security-auditor","state":"awaiting_review","done_criteria_met":"yes","handoff_target":"review-coordinator","review_verdict":"fail"}
```

## Invariants

- Append-only; the hook always exits 0 (never breaks a dispatch).
- The four base fields are always present and original four-field lines stay
  valid JSON.
- Optional contract fields are omit-if-absent — never emitted empty.
- An agent's current state is its latest entry by `ts`.
- The `/status-audit` skill is read-only and degrades gracefully: an absent
  ledger reports "no ledger yet", a malformed line is skipped with a note, and
  an absent optional field reads as "unknown" — never an error.

## Reading the ledger

Run `/status-audit` for a seven-view session-health report (state counts,
per-agent latest, blocked, stale ≥ 15 min, `done`-vs-`done_criteria_met`
contradictions, missing handoffs, and a review/QA verdict summary). For
continuous supervision of long headless work, use `/loop 5m /status-audit`.
