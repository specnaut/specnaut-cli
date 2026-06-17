---
name: executing-plans
description: Use to execute an implementation plan task-by-task inline in the current session, with checkpoint pauses for review between tasks. Trigger phrases include "execute this plan inline", "run the plan in-session", "implement task-by-task without subagents", or any handoff from writing-plans where the user picked "inline" over "subagent-driven". Faster for trivial plans where subagent dispatch overhead exceeds the catch rate.
---

# Executing Plans

Execute an implementation plan **task-by-task in the current session**,
with explicit checkpoint pauses between tasks for review. The simpler
sibling of `subagent-driven-development` — no subagent dispatch, no
two-stage per-task review, just sequential execution with the same TDD
discipline.

> Inspired by [obra/superpowers v5.1.0](https://github.com/obra/superpowers)
> (MIT) — `skills/executing-plans/SKILL.md`. Re-implemented for
> Specnaut with explicit checkpoint semantics and integration with the
> `writing-plans` execution-handoff fork.

## When to use this skill

Use `executing-plans` when:

- The plan has 1–3 trivial tasks where two-stage review overhead would
  exceed the catch rate
- The user explicitly picked "inline" at the `writing-plans`
  execution-handoff fork
- Subagent dispatch isn't available on the current harness (rare —
  check `references/<harness>-tools.md`)
- You need to preserve session context for downstream coordination
  (subagents lose context; inline keeps everything in your working set)

Use `subagent-driven-development` instead when:

- The plan has 3+ tasks where a bug in task N would cost real time to
  unwind in task N+2
- The cost of an early bug propagating outweighs the dispatch overhead
- You want spec-compliance + code-quality reviews catching issues
  between tasks

If unsure, default to `subagent-driven-development`. The two-stage
review caught 9+ correctness issues in a single day's work that inline
execution would have shipped to CI.

## The loop — per task

```
Read next task from plan
  → execute the task (TDD: write failing test, run, implement, run, commit)
    → checkpoint: self-review the work
      → if issues found → fix, re-run tests, re-commit
      → if clean → next task
```

**Continuous execution.** Don't pause for human check-in between tasks
unless the plan explicitly marks a step as `STOP — confirm with user`.
The user asked you to execute; execute.

Pause only for:

- An explicit `STOP` marker in the plan
- A test failure you cannot resolve in 2–3 attempts
- A scope-changing decision the plan didn't pre-resolve
- All tasks complete

## Step 1 — read the plan once

Read the plan file end-to-end. Note the task list, file structure,
out-of-scope markers, and any cross-task dependencies. Keep the plan
file's task list in your working context — you'll be jumping between
the plan and the code throughout execution.

## Step 2 — execute each task in order

For each task, follow the steps in the plan **literally**:

1. Read the step's code block (test, implementation, commit, etc.)
2. Apply the change exactly as specified
3. Run the verification command and confirm the expected output
4. Move to the next step

If a step's code block has a placeholder ("TODO", "TBD"), STOP — the
plan failed the `writing-plans` zero-placeholder discipline. Surface
the placeholder to the user before proceeding.

## Step 3 — self-review at task boundaries

After completing every step in a task, before moving to the next task,
self-review:

- **Completeness** — did you fully implement what the task spec said?
  Any silent skips?
- **Quality** — names clear, types accurate, no obvious bugs?
- **Tests** — do they verify real behavior, or just mock calls?
- **Discipline** — followed TDD if the task required it? Committed
  frequently?

Fix anything you find before moving on. This is the inline equivalent
of the spec-compliance review stage in `subagent-driven-development` —
you're the reviewer of your own work.

## Step 4 — final whole-plan review

Once every task in the plan is complete, run a whole-implementation
review by dispatching `requesting-code-review` over the full git range:

```
BASE_SHA=origin/main   # or the branch base
HEAD_SHA=$(git rev-parse HEAD)
```

This is the only subagent dispatch in the executing-plans flow — and
it's optional if the plan was trivial. Use the canonical template from
`requesting-code-review` (Strengths / Critical / Important / Minor /
Assessment).

Fix any Critical or Important issues before opening the PR.

## Step 5 — hand off to PR + merge

After the final review, the plan typically ends with PR creation:

```bash
git push --set-upstream origin <branch>
# Open PR via gh api -X POST repos/.../pulls (avoids GraphQL rate-limit)
# Watch CI, merge once green
# Dispatch product-owner agent to close the linked issue
```

The plan should specify the PR title and body. If it doesn't, fall
back to the conventional-commit subject of the most recent commit.

## Handling test failures

When a verification command fails:

1. Read the actual failure output, don't guess
2. Compare with the expected output in the plan
3. If the plan's expected output is wrong → flag it to the user and
   stop (the plan needs a fix, not the code)
4. If the implementation is wrong → fix it inline, re-run, continue

After 2–3 failed attempts to make a verification pass, STOP and
surface the situation. Looping on a stuck test wastes cycles and
context.

## Red flags

**Never:**

- Skip the self-review at task boundaries
- Proceed past a failing test you can't explain
- Apply a placeholder that the plan should have specified
- Batch-commit multiple tasks (each task gets its own commit per the
  plan's spec)
- Skip the final whole-plan review for non-trivial work

**If you find a real bug mid-execution:**

- Don't paper over it
- If it's in your work, fix and continue
- If it's in the plan, surface and ask for direction

## Integration with `writing-plans`

The `writing-plans` execution-handoff section offers the user a choice
between `subagent-driven-development` (recommended for complex plans)
and `executing-plans` (this skill, for simpler plans). When the user
picks "inline" at the fork, this skill is the entry point.

For trivial single-step plans, just execute the step without invoking
this skill explicitly — the overhead of reading the SKILL.md exceeds
the value.

## Pre-commit gate awareness

Specnaut's pre-commit hook runs `deno fmt --check`, `deno lint`,
`deno task bundle`, and `deno check src/main.ts` on every commit. When
a commit step fails for one of these reasons:

- `fmt` failure → `deno fmt <file>` to fix, re-stage, re-commit
- `bundle` regenerated → `git add src/templates_bundle.ts && git commit --amend --no-edit`
- `lint` / `check` failure → genuine error, surface to user with the
  exact output

## Pre-flight check

Before starting execution, confirm:

- You're on a feature branch (not `main`); if not, branch first per the
  plan
- The working tree is clean OR all dirty files are documented as
  intentional in the plan
- The plan file is readable and well-formed (has a Goal, Tasks, and
  Out-of-scope sections)

If any of these fail, surface and stop.

## Out of scope

This skill does not:

- Write plans (`writing-plans` does)
- Dispatch implementer subagents (`subagent-driven-development` does)
- Mutate the backlog (the `product-owner` agent does)
- Watch CI or merge PRs after task completion (the controller / user
  does, following the plan's PR-flow specification)
- Trigger releases (`/release` + `devops-sre` advisory)

## When NOT to use this skill

- Plans with 4+ tasks where bug propagation cost is real — use
  `subagent-driven-development` instead
- Single-file trivial changes — just do the change, no skill overhead
- When the harness lacks the file-modification tools (genuinely rare;
  every supported Specnaut harness has Read/Write/Edit equivalents)
