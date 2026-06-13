# Contract: WORKFLOW STATUS block

Defined by skill `workflow-contract`. Preloaded by: developer, review-coordinator, qa-tester, and all
auditors/reviewers (via workflow-contract). Emitted once, at end of turn, after the agent's prose.

## Format

```text
WORKFLOW STATUS
STATE: in_progress | blocked | awaiting_review | awaiting_qa | awaiting_user | done | failed
DONE_CRITERIA_MET: yes | no
SUMMARY: <one sentence — outcome, not effort>
ARTIFACTS: <comma list | none>
FILES_CHANGED: <comma list | none>
VALIDATION: <comma list of "command (result)" | none>
BLOCKERS: <one sentence | none>
NEXT_ACTION: <one sentence>
HANDOFF_TARGET: developer | review-coordinator | qa-tester | product-owner | workflow-manager | user | none
```

## Rules

- Exactly one block per turn; never replaces prose (additive).
- `STATE: done` only when assigned exit criteria are met; otherwise use `awaiting_review` /
  `awaiting_qa` / `blocked`. Never `done` with `DONE_CRITERIA_MET: no`.
- `FILES_CHANGED: none` for read-only agents (auditors/reviewers).
- `VALIDATION` is explicit, e.g. `deno task test (pass)`.
- `HANDOFF_TARGET: none` when work terminates here.
