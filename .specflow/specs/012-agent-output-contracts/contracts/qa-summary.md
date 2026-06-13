# Contract: QA SUMMARY block

Defined by skill `qa-report-contract`. Preloaded by: qa-tester. Emitted once, after the prose (and
before the WORKFLOW STATUS block, since qa-tester also carries workflow-contract).

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
