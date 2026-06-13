---
name: review-findings-contract
description: Defines the machine-readable REVIEW SUMMARY block every auditor/reviewer emits once after its prose, with severity counts and a verdict. Preloaded, not user-invocable.
user-invocable: false
---

# review-findings-contract

This skill defines the **REVIEW SUMMARY** block. Agents that preload it
(`architecture-auditor`, `performance-auditor`, `security-auditor`,
`a11y-auditor`, `dependency-auditor`, `code-reviewer`, `test-reviewer`, and the
`review-coordinator`) emit exactly one such block **after their prose** (and
before the WORKFLOW STATUS block when the agent also carries `workflow-contract`).
It normalizes the review's severity counts and verdict so a coordinator can
synthesize multiple seats' findings without re-reading each prose report. The
`review-coordinator` emits the same block with the **aggregated** counts summed
across every seat. The block is additive — it appends to the prose, never
replaces it.

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
