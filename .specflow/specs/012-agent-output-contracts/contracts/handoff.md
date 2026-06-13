# Contract: HANDOFF block

Defined by skill `handoff-protocol`. Preloaded by: developer, review-coordinator. Emitted immediately
after the WORKFLOW STATUS block, **only when** `HANDOFF_TARGET ≠ none`.

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
