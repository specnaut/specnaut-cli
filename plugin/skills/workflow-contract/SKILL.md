---
name: workflow-contract
description: Defines the machine-readable WORKFLOW STATUS block every workflow-shaped agent emits once at end of turn. Preloaded, not user-invocable.
user-invocable: false
constitution-exempt: an output-format contract preloaded by agents that already read the constitution first
---

# workflow-contract

This skill defines the **WORKFLOW STATUS** block. Agents that preload it
(`developer`, the five experts and `code-reviewer`) emit exactly one such block
at the **end of their turn, after the prose**. It is additive: the prose carries
the narrative, the block carries the fields something parses — the subagent log
hook reads `STATE`, `DONE_CRITERIA_MET` and `HANDOFF_TARGET` into
`.specnaut/logs/agents.jsonl`, and whoever resumes a blocked turn reads
`BLOCKERS`.

## Format

```text
WORKFLOW STATUS
STATE: in_progress | blocked | awaiting_review | awaiting_user | done | failed
DONE_CRITERIA_MET: yes | no
BLOCKERS: <one sentence | none>
HANDOFF_TARGET: developer | product-owner | user | none
```

## Rules

- Exactly one block per turn; never replaces prose (additive).
- `STATE: done` only when assigned exit criteria are met; otherwise use `awaiting_review` /
  `blocked`. Never `done` with `DONE_CRITERIA_MET: no`.
- `HANDOFF_TARGET: none` when work terminates here.
