---
name: auto-chain
description: Auto-chain Specflow workflow — when the user runs /auto-chain specify, chain clarify → plan → tasks → analyze → implement → review → merge, stopping only for required clarifications and final pre-merge validation.
---

# Specflow Auto-Chain

This skill turns the Specflow workflow into a single-command operation. When the
user invokes `/auto-chain specify "<feature description>"`, you MUST chain every
Specflow phase in the same session without asking the user between phases,
EXCEPT at the two checkpoints defined below.

## Default flow

```
specify → clarify → plan → tasks → analyze → implement → review → merge
          ▲                                                        ▲
          STOP #1 (only if clarifications needed)                  STOP #2 (pre-merge validation)
```

## Per-phase behavior

After each phase completes successfully, immediately invoke the next phase via
the `Skill` tool (or the platform equivalent). Do not emit a user-facing "ready
for next step?" prompt. A one-line `✓ <phase> complete — proceeding to <next>`
log is sufficient.

## STOP #1 — Clarification checkpoint

After `/specflow-clarify` finishes:

- If zero `[NEEDS CLARIFICATION]` markers remain in `spec.md`, continue silently
  to `/specflow-plan`.
- If markers remain, present the top 3 questions to the user (per the
  `/specflow-clarify` format) and wait for answers. Once the spec is updated,
  resume the chain automatically.

## Silent gates

These phases run without user interruption unless they fail hard or surface
CRITICAL findings:

- `/specflow-plan` — generates plan + research + data-model + contracts + quickstart.
- `/specflow-tasks` — generates tasks.md.
- `/specflow-analyze` — cross-artifact consistency check. On LOW/MEDIUM findings,
  log a summary and continue. On CRITICAL findings, stop and surface them.
- `/specflow-implement` — runs the developer → review-coordinator → qa-tester
  pipeline. Has its own internal fix loop for review findings; do not intercept.
- `/specflow-review` — final quality scan.

## STOP #2 — Pre-merge validation

After `/specflow-review` passes, ALWAYS stop and present a compact summary
before invoking `/specflow-merge`. The summary must include:

- Feature name and branch
- Files created / modified (count + key paths)
- Tests added and full-suite status
- Known deviations from tasks.md and rationale
- Open risks / deferred items
- One-line business outcome

Then ask explicitly: "Ready to merge? (yes to run /specflow-merge, no to stay on
the branch)". Wait for explicit confirmation. On "yes", invoke
`/specflow-merge`. After merge, the chain ends.

## Opt-out

If the user invokes `/auto-chain specify --manual "<description>"`, run
`/specflow-specify` only and stop. Do not auto-chain. Each subsequent phase must
be invoked manually by the user.

## Single-phase invocations

When the user invokes any phase directly (e.g. `/auto-chain clarify 042`,
`/auto-chain plan 042`) — i.e. NOT via the entry point `/auto-chain specify` — the
command is one-shot. Do NOT auto-chain. Single-phase invocations exist for
re-running phases on an existing feature.

## Failure handling

- Hard failure in a silent gate (plan/tasks/analyze/implement/review): stop,
  surface the error, ask the user how to proceed. Do not silently retry.
- Task-level blockers reported by the developer agent during `implement`: the
  implement workflow has its own fix loop; do not intercept.
- `clarify` producing more than 5 questions: present the top 3 per the
  `/specflow-clarify` quota; the rest can be asked later.

## Context budget

Long features (≥13 story points or ≥30 tasks) may exhaust context during
`/specflow-implement`. If compaction occurs mid-chain, inform the user and let
them resume manually from the last completed phase.
