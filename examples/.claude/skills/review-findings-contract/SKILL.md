---
name: review-findings-contract
description: Normalized review findings contract for reviewer agents and review coordinators. Preload into review agents so their findings counts and verdicts are machine-readable in the workflow ledger.
user-invocable: false
---

# Review Findings Contract

Use this skill for any code review, security audit, test review, accessibility
audit, API contract review, design system review, performance review, or unified
review gate report.

## Goal

Make review output machine-readable so the workflow ledger and status audit can
detect severity, verdict, and fix urgency without interpreting prose.

## Required Review Summary Block

Before the workflow status block, append this block exactly once:

```text
REVIEW SUMMARY
REVIEW_SCOPE: reviewer name or review gate scope
REVIEW_VERDICT: pass | fail | needs_followup
CRITICAL_COUNT: integer
HIGH_COUNT: integer
MEDIUM_COUNT: integer
LOW_COUNT: integer
TOP_ISSUES: one sentence or none
RECOMMENDATION: one sentence
```

## Rules

- `REVIEW_VERDICT: pass` only if critical and high findings are both zero.
- `REVIEW_VERDICT: fail` if critical or high findings exist.
- `REVIEW_VERDICT: needs_followup` if only medium or low issues remain.
- Counts must be explicit integers, including zero.
- `TOP_ISSUES` should summarize the most important unresolved problems.
- `RECOMMENDATION` should tell the next actor what to do.

## Alignment With Workflow Status

- `REVIEW_VERDICT: pass` usually pairs with `STATE: done` or `awaiting_qa`.
- `REVIEW_VERDICT: fail` usually pairs with `STATE: awaiting_review` and a
  handoff to `developer`.
- `REVIEW_VERDICT: needs_followup` can pair with `STATE: awaiting_qa` or
  `STATE: done`, depending on the gate policy.

## Example

```text
REVIEW SUMMARY
REVIEW_SCOPE: unified review gate for spec 176
REVIEW_VERDICT: fail
CRITICAL_COUNT: 0
HIGH_COUNT: 2
MEDIUM_COUNT: 3
LOW_COUNT: 1
TOP_ISSUES: Missing authorization check and stale cache invalidation remain unresolved.
RECOMMENDATION: Route the feature back to developer for one fix cycle, then rerun the review gate.
```