# Data Model — `/code-audit`

No runtime store. The model is the scope-script output schema, the seat-selection relation, and the
synthesized report shape. Asserted by the script behaviour test + skill-content tests.

## Entity: Audit run (aggregate root)

Identity = scope label + timestamp. Owns the seat set, seat results, aggregated verdict. Read-only;
output is the unified report.

## Entity: Seat result

Identity = (audit run, auditor name). Carries that seat's parsed `REVIEW SUMMARY` (verdict +
counts) + findings, OR an `errored` / `empty` marker (never silently dropped).

## Value object: Scope(label, commits, files)

- `label` ∈ {`path`, `range`, `unpushed`, `since-tag`, `last-N`}
- `commits` — list; `files` — changed/tracked file list
- `TOTAL_FILES` — integer; `0` ⇒ "nothing to audit", no seat dispatch

## Value object: CategorySignals

Non-negative integers emitted by the script: `FRONTEND_COUNT`, `TEST_COUNT`, `DEP_COUNT`,
`INFRA_COUNT`. Govern seat selection.

## Value object: Finding(file, line, severity, description)

Deduplicated by `(file, line)` across seats, keeping the most detailed instance. `severity` ∈
{critical, high, medium, low}.

## Value object: AggregatedVerdict(value, summedCounts)

- `value` ∈ {`pass`, `fail`, `needs_followup`}
- Dominance: `fail` if any seat `fail`; else `needs_followup` if any seat `needs_followup`; else
  `pass`.
- `summedCounts` = per-seat sums of CRITICAL/HIGH/MEDIUM/LOW.

## Relation: Seat selection

`CategorySignals → {seats}` per the authoritative table:

| Seat          | Agent                | Deployed when        |
| ------------- | -------------------- | -------------------- |
| Architecture  | architecture-auditor | scope non-empty      |
| Security      | security-auditor     | scope non-empty      |
| Performance   | performance-auditor  | scope non-empty      |
| Accessibility | a11y-auditor         | `FRONTEND_COUNT > 0` |
| Dependency    | dependency-auditor   | `DEP_COUNT > 0`      |

Invariants: zero governing signal ⇒ seat skipped + skip recorded; seats dispatched in one parallel
batch; aggregated verdict obeys dominance; empty scope ⇒ no dispatch.
