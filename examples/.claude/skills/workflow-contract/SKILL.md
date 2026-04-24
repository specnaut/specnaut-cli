---
name: workflow-contract
description: Shared execution contract for multi-agent workflows. Preload into manager, developer, QA, and review agents so they always report structured state, blockers, validation, and next action.
user-invocable: false
---

# Workflow Contract

Use this skill whenever you are participating in a coordinated workflow with one
or more other agents.

## Core Rule

Do not end a meaningful work segment with freeform prose only. Emit a structured
status block that another agent or a workflow audit can consume reliably.

## Required Status Block

At the end of each completed phase, and always before stopping, include this
block exactly once:

```text
WORKFLOW STATUS
STATE: in_progress | blocked | awaiting_review | awaiting_qa | awaiting_user | done | failed
DONE_CRITERIA_MET: yes | no
SUMMARY: one concise sentence
ARTIFACTS: comma-separated list or none
FILES_CHANGED: comma-separated list or none
VALIDATION: comma-separated commands/results or none
BLOCKERS: one sentence or none
NEXT_ACTION: one sentence
HANDOFF_TARGET: developer | review-coordinator | qa-tester | product-owner | workflow-manager | user | none
```

## State Semantics

- `in_progress`: Work is underway and no handoff is required yet.
- `blocked`: You cannot proceed without missing context, permissions, or an
  external fix.
- `awaiting_review`: Implementation is complete enough for review.
- `awaiting_qa`: Review and checks are complete enough for QA.
- `awaiting_user`: A user decision is required before proceeding.
- `done`: Your assigned scope is complete and no further work is needed from
  you.
- `failed`: You attempted the work and hit a terminal failure.

## Completion Rules

- Never write `STATE: done` unless your assigned exit criteria are actually met.
- If you finished coding but review has not happened, use `awaiting_review`, not
  `done`.
- If you finished review but QA has not happened, use `awaiting_qa`, not `done`.
- If validation was requested but not run, `DONE_CRITERIA_MET` must be `no`.
- If there is any blocker or ambiguity, surface it in `BLOCKERS` and choose the
  correct non-terminal state.

## Reporting Rules

- `SUMMARY` must describe outcome, not effort.
- `ARTIFACTS` should name outputs another agent can consume: report, patch,
  checklist, test file, spec brief, etc.
- `FILES_CHANGED` must be `none` for read-only agents.
- `VALIDATION` should be explicit: `npm run typecheck (pass)`.
- `NEXT_ACTION` should be directly actionable by the handoff target.

## Examples

```text
WORKFLOW STATUS
STATE: awaiting_review
DONE_CRITERIA_MET: yes
SUMMARY: Implemented the gallery cache fix and updated the resolver behavior.
ARTIFACTS: patch applied, implementation summary
FILES_CHANGED: app/helpers/resolve_urls.ts, inertia/helpers/storage_url.ts
VALIDATION: npm run typecheck (pass)
BLOCKERS: none
NEXT_ACTION: Review the changed files for correctness and regressions.
HANDOFF_TARGET: review-coordinator
```

```text
WORKFLOW STATUS
STATE: blocked
DONE_CRITERIA_MET: no
SUMMARY: Reached the QA phase but cannot run browser tests because the app is not accessible.
ARTIFACTS: gap analysis
FILES_CHANGED: none
VALIDATION: none
BLOCKERS: Missing running app or reproducible test target for browser validation.
NEXT_ACTION: Provide a runnable environment or limit QA to unit and functional suites.
HANDOFF_TARGET: user
```