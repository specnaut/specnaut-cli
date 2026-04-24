---
name: qa-report-contract
description: Structured QA report contract for qa-tester runs. Preload into QA agents so workflow audits can read verdicts, test counts, and bug totals directly from the ledger.
user-invocable: false
---

# QA Report Contract

Use this skill for QA validation, test coverage reports, and post-fix
verification runs.

## Required QA Summary Block

Before the workflow status block, append this block exactly once:

```text
QA SUMMARY
QA_SCOPE: one sentence
QA_VERDICT: pass | fail | blocked
NEW_UNIT_TESTS: integer
NEW_FUNCTIONAL_TESTS: integer
NEW_BROWSER_TESTS: integer
TOTAL_PASS_COUNT: integer
TOTAL_FAIL_COUNT: integer
BUGS_FOUND: integer
QA_RECOMMENDATION: one sentence
```

## Rules

- `QA_VERDICT: pass` only if requested QA scope is complete and `TOTAL_FAIL_COUNT`
  is zero.
- `QA_VERDICT: fail` if tests exposed real product bugs or failing automation.
- `QA_VERDICT: blocked` if QA could not complete because the environment or
  prerequisites were missing.
- Every numeric field must be an explicit integer, including zero.
- `BUGS_FOUND` counts product issues or failing flows, not stylistic concerns.
- `QA_RECOMMENDATION` must state the next action clearly.

## Alignment With Workflow Status

- `QA_VERDICT: pass` usually pairs with `STATE: done`.
- `QA_VERDICT: fail` usually pairs with `STATE: awaiting_qa` and a handoff to
  `developer`.
- `QA_VERDICT: blocked` usually pairs with `STATE: blocked` or
  `STATE: awaiting_user`.

## Example

```text
QA SUMMARY
QA_SCOPE: regression coverage for gallery and public profile image rendering
QA_VERDICT: pass
NEW_UNIT_TESTS: 2
NEW_FUNCTIONAL_TESTS: 1
NEW_BROWSER_TESTS: 1
TOTAL_PASS_COUNT: 47
TOTAL_FAIL_COUNT: 0
BUGS_FOUND: 0
QA_RECOMMENDATION: Close the workflow and proceed to release review if needed.
```