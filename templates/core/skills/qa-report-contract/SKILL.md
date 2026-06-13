---
name: qa-report-contract
description: Defines the machine-readable QA SUMMARY block the qa-tester emits once after its prose, with test counts and a verdict. Preloaded, not user-invocable.
user-invocable: false
---

# qa-report-contract

This skill defines the **QA SUMMARY** block. The agent that preloads it
(`qa-tester`) emits exactly one such block **after its prose** (and before the
WORKFLOW STATUS block, since `qa-tester` also carries `workflow-contract`). It
normalizes the QA pass's test counts, bug count, and verdict so downstream
tooling can gate on QA results without parsing the prose. The block is additive
— it appends to the prose, never replaces it.

## Format

```text
QA SUMMARY
QA_SCOPE: <one sentence>
QA_VERDICT: pass | fail | blocked
NEW_UNIT_TESTS: <integer>
NEW_FUNCTIONAL_TESTS: <integer>
NEW_BROWSER_TESTS: <integer>
TOTAL_PASS_COUNT: <integer>
TOTAL_FAIL_COUNT: <integer>
BUGS_FOUND: <integer>
QA_RECOMMENDATION: <one sentence>
```

## Rules

- `QA_VERDICT: pass` only when the requested QA scope is complete **and** `TOTAL_FAIL_COUNT == 0`.
- `QA_VERDICT: fail` when tests exposed real product bugs or failing automation.
- `QA_VERDICT: blocked` when QA could not run (missing environment/prereqs) — distinct from `fail`.
- Every numeric field is an explicit integer, including `0`.
- `BUGS_FOUND` counts product issues / failing flows, not stylistic concerns.
