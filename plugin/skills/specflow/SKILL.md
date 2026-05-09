---
name: specflow
disable-model-invocation: true
description: Specflow workflow router — entry point for the spec-driven pipeline. `/specflow <phase> [args]` dispatches to a single phase (specify, clarify, plan, tasks, analyze, implement, review, merge, constitution, checklist, groom). `/specflow` with no args prints the workflow overview.
argument-hint: <specify|clarify|plan|tasks|analyze|implement|review|merge|constitution|checklist|groom> [args]
when_to_use: |
  Trigger phrases that should route here:
  - specify: "spec out a feature", "write a spec", "create a specification"
  - clarify: "clarify requirements", "fill in gaps in the spec"
  - plan: "plan a feature", "build a technical plan"
  - tasks: "generate tasks", "break down the plan"
  - analyze: "check consistency", "analyze artifacts"
  - implement: "implement the feature", "start coding"
  - review: "review the implementation", "run quality gates"
  - merge: "merge the branch", "ship the feature"
  - constitution: "update the constitution", "edit project rules"
  - checklist: "generate a checklist"
  - groom: "groom the backlog", "run a hygiene pass"
---

# Specflow router

`$ARGUMENTS` carries the user's input. Parse it as `<phase> [rest]`:

- The first token is the phase name.
- Everything after the first whitespace is the argument string for that phase.

If `$ARGUMENTS` is empty, render the **Workflow overview** below and stop. Do not pick a phase yourself.

## Phase index

| Phase | Reference | One-liner |
|-------|-----------|-----------|
| `specify` | `phases/specify.md` | Create or update the feature spec from a natural-language description. |
| `clarify` | `phases/clarify.md` | Resolve ambiguities in the spec via structured questioning. |
| `plan` | `phases/plan.md` | Generate the technical plan, research, data model, contracts, quickstart. |
| `tasks` | `phases/tasks.md` | Produce `tasks.md` from the plan. |
| `analyze` | `phases/analyze.md` | Cross-artifact consistency check (spec ↔ plan ↔ tasks). |
| `implement` | `phases/implement.md` | Run the developer → review-coordinator → qa-tester pipeline against `tasks.md`. |
| `review` | `phases/review.md` | Final quality scan over the implementation. |
| `merge` | `phases/merge.md` | Pre-merge validation and merge the feature branch. |
| `constitution` | `phases/constitution.md` | Edit the project's `constitution.md` rules. |
| `checklist` | `phases/checklist.md` | Generate a quality checklist for the current spec. |
| `groom` | `phases/groom.md` | Backlog hygiene pass via the product-owner agent. |

## Routing

1. **Read** the phase reference file (`phases/<phase>.md`) for the requested phase using the `Read` tool.
2. **Substitute** the remainder of `$ARGUMENTS` for the phase's input.
3. **Execute** the procedure in the reference file end-to-end.

Unknown phase → print the index above and stop.

## Workflow overview

```
specify → clarify → plan → tasks → analyze → implement → review → merge
                                                                    ▲
                                                          STOP for pre-merge validation
```

`constitution`, `checklist`, and `groom` are out-of-band utilities, not part of the linear flow.

## Typical flow

```
/specflow specify "Add OAuth2 login"
  → spec drafted in .specflow/specs/<NNN>-add-oauth2-login/spec.md

/specflow clarify
  → resolves any [NEEDS CLARIFICATION] markers

/specflow plan
  → research, data-model, contracts, quickstart written

/specflow tasks
  → tasks.md generated

/specflow analyze
  → cross-artifact consistency check

/specflow implement
  → developer → review-coordinator → qa-tester pipeline

/specflow review
  → final quality scan

/specflow merge
  → pre-merge validation + merge
```

For an end-to-end run that auto-chains the silent gates, use `/auto-chain specify "<feature>"`.
