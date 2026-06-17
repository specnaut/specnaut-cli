# Contract: REVIEW SUMMARY block

Defined by skill `review-findings-contract`. Preloaded by: architecture-auditor,
performance-auditor, security-auditor, a11y-auditor, dependency-auditor, code-reviewer,
test-reviewer. Emitted once, after the prose (and before the WORKFLOW STATUS block when the agent
also carries workflow-contract).

## Format

```text
REVIEW SUMMARY
REVIEW_SCOPE: <reviewer name or gate scope>
REVIEW_VERDICT: pass | fail | needs_followup
CRITICAL_COUNT: <integer>
HIGH_COUNT: <integer>
MEDIUM_COUNT: <integer>
LOW_COUNT: <integer>
TOP_ISSUES: <one sentence, or up to 5 lines | none>
RECOMMENDATION: <one sentence — what the next actor should do>
```

## Rules

- `REVIEW_VERDICT: pass` only when `CRITICAL_COUNT == 0` **and** `HIGH_COUNT == 0`.
- `REVIEW_VERDICT: fail` when `CRITICAL_COUNT > 0` **or** `HIGH_COUNT > 0`.
- `REVIEW_VERDICT: needs_followup` when only Medium/Low findings remain.
- Every count is an explicit integer, including `0`.
- Verdict and counts must never contradict.
