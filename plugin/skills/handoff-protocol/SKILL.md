---
name: handoff-protocol
description: Defines the machine-readable HANDOFF block emitted right after WORKFLOW STATUS whenever an agent hands work to another actor. Preloaded, not user-invocable.
user-invocable: false
---

# handoff-protocol

This skill defines the **HANDOFF** block. Agents that preload it (`developer`,
`review-coordinator`, `workflow-manager`) emit it **immediately after the
WORKFLOW STATUS block, and only when** that block's `HANDOFF_TARGET` is not
`none`. It gives the next actor a precise, executable instruction plus the
concrete payload they need, so the handoff requires no re-derivation of intent.
The block is additive — it appends to the prose, never replaces it.

Agents that hand off but do NOT preload this contract (e.g. `qa-tester`, which
routes bugs to the developer) signal the target through the WORKFLOW STATUS
`HANDOFF_TARGET` field rather than emitting a full HANDOFF block — they carry
`workflow-contract` but not `handoff-protocol` by design.

## Format

```text
HANDOFF
TARGET: developer | review-coordinator | qa-tester | product-owner | workflow-manager | user
REASON: <one sentence>
REQUESTED_ACTION: <one imperative sentence — executable without reinterpretation>
PAYLOAD: <concrete filenames, ids, findings, spec ids the next actor needs>
OPEN_RISKS: <comma list | none>
```

## Rules

- Block exists **iff** `HANDOFF_TARGET ≠ none`; if there is no real handoff, omit it entirely.
- `TARGET` must equal the WORKFLOW STATUS `HANDOFF_TARGET`.
- `REQUESTED_ACTION` is precise enough to execute without re-deriving intent.
- `PAYLOAD` names concrete artifacts, never vague references.
