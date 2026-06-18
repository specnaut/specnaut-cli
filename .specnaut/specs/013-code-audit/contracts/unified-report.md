# Contract: `/code-audit` unified report

The skill emits ONE report (inline; optionally persisted at
`docs/specflow/audits/YYYY-MM-DD-code-audit.md`).

## Shape

```text
## Code Audit — <SCOPE_LABEL>

### Scope
- <N commits>, <M files> | seats deployed: <list> | skipped: <seat (reason)>, …

### Seats
| Seat | Agent | Status | Findings |
|------|-------|--------|----------|
| Architecture | architecture-auditor | ✅ / errored / empty | <n> |
| …            | …                    | …       | … |

### 🏛 Architecture   ### 🔒 Security   ### ⚡ Performance   ### ♿ Accessibility   ### 📦 Dependency
- (only the deployed seats) CRITICAL/HIGH/MEDIUM/LOW findings, each `file:line` + suggested fix,
  deduplicated by file+line across seats (most detailed kept), severity-ranked.

### Top issues to fix first
1. …

### Verdict: HEALTHY | NEEDS WORK | DEBT ACCRUING
```

Then the aggregated normalized block (per `review-findings-contract`):

```text
REVIEW SUMMARY
REVIEW_SCOPE: code-audit <SCOPE_LABEL> (seats: <list>)
REVIEW_VERDICT: pass | fail | needs_followup
CRITICAL_COUNT: <sum>
HIGH_COUNT: <sum>
MEDIUM_COUNT: <sum>
LOW_COUNT: <sum>
TOP_ISSUES: <one sentence | none>
RECOMMENDATION: <one sentence>
```

## Rules

- Seat selection (decidable from the existing category signals — no `DOCS_COUNT` signal exists):
  architecture, security, and performance deploy on any non-empty scope; accessibility iff
  `FRONTEND_COUNT > 0`; dependency iff `DEP_COUNT > 0`.
- `REVIEW_VERDICT`: `fail` if any seat `fail`; else `needs_followup` if any seat `needs_followup`;
  else `pass`. Counts = per-seat sums.
- A skipped seat is listed in `### Scope` with its reason; an errored/empty seat is shown in the
  table, never silently dropped.
- Read-only: producing this report mutates no tracked files. The optional report write to
  `docs/specflow/audits/YYYY-MM-DD-code-audit.md` is the sole permitted file write (a new artifact,
  not an edit to audited code).
- Empty scope (`TOTAL_FILES: 0`) → a one-line "nothing to audit; widen with --path/--range/--last"
  in place of the report; no seats, no REVIEW SUMMARY.
