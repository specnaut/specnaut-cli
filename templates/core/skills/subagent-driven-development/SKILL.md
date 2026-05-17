---
name: subagent-driven-development
description: Use to execute an implementation plan task-by-task with mandatory two-stage review per task (spec compliance, then code quality). Trigger phrases include "execute this plan", "implement task by task", "subagent-driven", "run the plan with reviews", or any prompt that asks to drive a multi-task plan to completion with quality gates between tasks. Dispatches Specflow's bundled developer + code-reviewer agents.
---

# Subagent-Driven Development

Execute a plan by dispatching a **fresh subagent per task**, with a
**two-stage review** after each: spec compliance first, then code
quality. The controller (you) extracts each task's text and context
from the plan, dispatches the implementer subagent with precisely the
information it needs, then dispatches two reviewer subagents in
sequence to catch issues before they cascade into the next task.

> Inspired by [obra/superpowers v5.1.0](https://github.com/obra/superpowers)
> (MIT) — `skills/subagent-driven-development/SKILL.md`. Re-implemented
> for Specflow with explicit dispatch to the bundled `developer` agent
> (implementer role) and `code-reviewer` agent (both review stages, with
> different prompts).

**Why subagents:** you delegate to specialized agents with isolated
context. By precisely crafting their instructions, you ensure they
stay focused and succeed at their task. They should never inherit your
session's history — you construct exactly what they need. This also
preserves your own context for coordination work across all tasks.

**Core principle:** Fresh subagent per task + two-stage review (spec
then quality) = high quality, fast iteration.

## When to use this skill

- After the `writing-plans` skill produced a plan and the user picked
  "subagent-driven" at the execution-handoff fork
- For any plan with 3+ tasks where the cost of a bug propagating to
  later tasks is real (anything cross-cutting or touching critical
  infrastructure)
- When you want to preserve your own controller context for the
  multi-task coordination view (subagents do the heavy reading)

Use the simpler `executing-plans` skill (#274 once shipped) instead
when:

- The plan has 1–2 trivial tasks where review overhead exceeds the
  catch rate
- The user explicitly asked for inline execution
- Subagent dispatch is unavailable on the current harness (rare —
  see `references/<harness>-tools.md` for the dispatch mapping)

## The loop — per task

```
Read plan → extract task N text + context → dispatch implementer
  → implementer reports DONE
    → dispatch spec-compliance reviewer
      → if NOT compliant → implementer fixes → re-review
      → if compliant → dispatch code-quality reviewer
        → if issues → implementer fixes → re-review
        → if approved → mark task complete → next task
```

**Continuous execution.** Do not pause between tasks for human
check-ins. Drive every task to completion. The only reasons to stop are:

- An implementer reports `BLOCKED` you cannot resolve
- A reviewer flags a Critical issue and the implementer can't fix it
- The plan itself proves wrong and needs a re-plan
- All tasks are complete

Progress summaries and "should I continue?" prompts waste the user's
time. They asked you to execute; execute.

## Step 1 — extract all tasks upfront

Read the plan file **once**. Extract every task with full text and any
context the implementer needs ("Files", "Notes", state from previous
tasks). Keep the structured task list in your controller context so
each dispatch is one-shot — the implementer should never need to
read the plan file.

## Step 2 — dispatch the implementer

Use Specflow's bundled `developer` agent (it knows the project
conventions: hexagonal layout, TDD discipline, in-code documentation,
Windsurf cap, byte-identity plugin sync, smoke audit, pre-commit
hook gates).

```
Task({
  subagent_type: "developer",
  description: "Implement Task N: <short summary>",
  prompt: `
    You are implementing Task N of <plan path>.

    ## Task Description

    <FULL TEXT of task — paste verbatim from the plan>

    ## Context

    <Scene-setting: where this fits, dependencies, architectural
    context from earlier tasks if relevant>

    ## Before You Begin

    If the requirements or approach are unclear, ASK NOW. Don't
    guess. Raise concerns before starting.

    ## Your Job

    1. Implement exactly what the task specifies
    2. Follow TDD if the task says to
    3. Verify the implementation works
    4. Commit your work
    5. Self-review (see below)
    6. Report back

    Work from: <project absolute path>

    ## Report Format

    - Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
    - What you implemented
    - What you tested and the results
    - Files changed + commit sha
    - Self-review findings
  `
})
```

For trivial mechanical tasks (1–2 file edits, isolated functions), the
faster `haiku` model is enough. For multi-file integration tasks or
debugging, use the standard model. For architecture-level work the
implementer should ESCALATE to you (the controller) rather than guess.

## Step 3 — dispatch the spec-compliance reviewer

After the implementer reports DONE, do **NOT** trust the report —
verify against the plan independently. Dispatch the `code-reviewer`
agent in **spec-compliance mode** with this prompt:

```
Task({
  subagent_type: "code-reviewer",
  description: "Spec compliance review — Task N",
  prompt: `
    You are reviewing whether an implementation matches its specification.

    ## What Was Requested

    <FULL TEXT of the task from the plan, verbatim>

    ## What Implementer Claims They Built

    <From the implementer's report>

    ## CRITICAL: Do NOT trust the implementer's report.

    The implementer may have skipped requirements or added extras.
    You MUST verify by reading the actual code.

    ## Your Job — verify line by line

    Read the implementation code and check:

    - Missing requirements — did they implement everything?
    - Extra/unneeded work — did they over-build?
    - Misunderstandings — did they solve the wrong problem?

    Use \`git diff --stat <BASE>..<HEAD>\` and \`git diff\` to see
    the actual changes.

    ## Report

    - ✅ Spec compliant — cite verified line numbers from the actual file.
    - ❌ Issues found — list each gap with file:line references.
  `
})
```

If the reviewer reports ❌, dispatch the implementer again with the
spec gaps as the fix list. Re-review until ✅.

## Step 4 — dispatch the code-quality reviewer

Only **after** spec compliance is ✅, run the code-quality review. Use
the canonical prompt template from the `requesting-code-review` skill
(see `templates/core/skills/requesting-code-review/SKILL.md` for the
verbatim template). It returns Strengths / Critical / Important /
Minor / Recommendations / Assessment.

- **Critical issues** → implementer fixes immediately, re-review.
- **Important issues** → implementer fixes before moving on, re-review.
- **Minor issues** → note for follow-up, mark task complete.

## Step 5 — mark task complete, advance

Once both reviews are ✅ (or only Minor remains), mark the task done in
your tracking, then return to Step 2 for the next task.

## Handling implementer status codes

The implementer reports one of four statuses. Handle each:

| Status | Action |
|---|---|
| `DONE` | Proceed to spec compliance review (Step 3). |
| `DONE_WITH_CONCERNS` | Read the concerns. If correctness-related, fix before review. If observational ("this file is getting large"), note and proceed. |
| `NEEDS_CONTEXT` | Provide the missing context and re-dispatch (same agent, fresh attempt). |
| `BLOCKED` | Assess: context problem (re-dispatch with more context) / too hard (re-dispatch with a more capable model) / task too big (break into smaller pieces) / plan wrong (escalate to user). NEVER ignore an escalation or retry with the same model unchanged. |

## Model selection

Use the least capable model that can handle each role:

- **Mechanical implementation** (isolated functions, clear specs, 1–2
  files): cheap model. Most tasks are mechanical when the plan is
  well-specified.
- **Integration / debugging** (multi-file coordination, pattern
  matching, judgment): standard model.
- **Architecture / design / review**: most capable model.

Pass `model: "haiku"` for fast cheap dispatches, default otherwise.

## Red flags

**Never:**

- Skip either review (spec OR quality)
- Proceed with unfixed Critical or Important issues
- Dispatch multiple implementer subagents in parallel (conflicts)
- Make the subagent read the plan file (provide the full task text
  in the dispatch instead)
- Skip the scene-setting context (subagents have NO history of your
  session — they need to understand where the task fits)
- Ignore subagent questions (answer them before they proceed)
- **Start code quality review before spec compliance is ✅** (wrong order)
- Move to the next task while either review has open issues

**If the reviewer is wrong:**

- Push back with concrete technical reasoning
- Show the code / tests that prove correctness
- Request clarification

**If the implementer fails after retries:**

- Don't try to fix manually — that pollutes your controller context.
- Dispatch a fix subagent with specific instructions, or escalate to
  the user for plan adjustment.

## Integration with `writing-plans`

The `writing-plans` skill's execution-handoff section offers the user a
choice between subagent-driven (this skill) and inline (`executing-plans`).
When the user picks subagent-driven, this skill is the entry point:

1. Read the plan once
2. Extract all tasks
3. Run the per-task loop
4. After all tasks complete, dispatch a final whole-implementation
   reviewer (one more `code-reviewer` dispatch with the whole plan
   diff `BASE_SHA=origin/main..HEAD`)
5. Hand off to `finishing-a-development-branch` (or the equivalent
   manual PR + merge + close flow) — typically opens the PR, watches
   CI, merges, dispatches the `product-owner` agent to close the
   linked issue

## Out of scope

This skill does not:

- Write plans (`writing-plans` does that)
- Run tests itself (the implementer does)
- Mutate the backlog (the `product-owner` agent does)
- Open branches / PRs (the implementer or controller does, depending
  on the plan's PR-flow specification)
- Trigger releases (`/release` + `devops-sre` advisory)

## When NOT to use this skill

- For trivial single-file changes — direct execution is faster than
  the subagent loop overhead
- When dispatch isn't available on the current harness (rare; check
  `references/<harness>-tools.md`)
- When the user explicitly asked for inline execution
