---
name: handoff-protocol
description: Handoff protocol for agent-to-agent coordination. Preload into workflow agents so every completion report includes the next owner, exact requested action, and unresolved risks.
user-invocable: false
---

# Handoff Protocol

Use this skill whenever your work product will be consumed by another agent or
by the lead orchestrator.

## Goal

Make handoffs precise enough that the next agent does not need to infer intent.

## Required Handoff Addendum

If `HANDOFF_TARGET` is not `none`, append this block immediately after the
workflow status block:

```text
HANDOFF
TARGET: developer | review-coordinator | qa-tester | product-owner | workflow-manager | user
REASON: one sentence
REQUESTED_ACTION: one sentence imperative
PAYLOAD: exact findings, questions, or artifact names needed by the next actor
OPEN_RISKS: comma-separated list or none
```

## Rules

- `TARGET` must match `HANDOFF_TARGET` from the workflow status block.
- `REQUESTED_ACTION` must be explicit enough to execute without reinterpretation.
- `PAYLOAD` should include concrete filenames, issue lists, spec IDs, or test
  names instead of vague references.
- `OPEN_RISKS` should list anything the next agent must re-check.
- If there is no real handoff, do not emit this block.

## State Alignment

- `awaiting_review` almost always hands off to `review-coordinator`.
- `awaiting_qa` almost always hands off to `qa-tester`.
- `blocked` or `awaiting_user` often hand off to `workflow-manager` or `user`.
- `done` should usually use `HANDOFF_TARGET: none` unless a downstream phase is
  explicitly required.

## Example

```text
HANDOFF
TARGET: review-coordinator
REASON: Implementation is complete and ready for the review gate.
REQUESTED_ACTION: Run the full review gate on the changed feature files.
PAYLOAD: Changed files app/services/gallery_service.ts, inertia/helpers/storage_url.ts, tests/unit/helpers/resolve_urls.spec.ts
OPEN_RISKS: signed URL cache regressions, local /uploads path regressions
```