---
name: workflow-contract
description: Defines the machine-readable WORKFLOW STATUS block every workflow-shaped agent emits once at end of turn. Preloaded, not user-invocable.
user-invocable: false
---

# workflow-contract

This skill defines the **WORKFLOW STATUS** block. Agents that preload it
(`developer`, `review-coordinator`, `workflow-manager`, `qa-tester`, and all
five auditors + both reviewers via this contract) emit exactly one such block at
the **end of their turn, after the prose**. The block is additive — it never replaces the prose narrative; it
appends a normalized, fenced, machine-readable summary that downstream tooling
(audit synthesis, the status ledger, `/status-audit`) can parse without
re-reading the prose.

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
