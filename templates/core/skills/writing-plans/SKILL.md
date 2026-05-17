---
name: writing-plans
description: Use when the user wants to plan a feature, an issue, a refactor, or any multi-step engineering task before touching code. Trigger phrases include "plan this", "write a plan", "give me an implementation plan", "plan how to fix #N", "design the implementation for X". Produces a single executable plan file with bite-sized TDD-style tasks and zero placeholders.
---

# Writing Plans

Turn a feature request, an issue URL, or a free-form requirement into a
**single executable plan file** that a developer (you, a subagent, or
another human) can follow step-by-step without re-reading the spec.

> Inspired by [obra/superpowers v5.1.0](https://github.com/obra/superpowers)
> (MIT) — `skills/writing-plans/SKILL.md`. Re-implemented for Specflow
> with `docs/specflow/plans/` as the canonical save path and explicit
> handoff to Specflow's `subagent-driven-development` / `executing-plans`
> skills (`subagent-driven-development` and `executing-plans`).

## When to use this skill

Use when:

- The user pastes a GitHub issue URL and says "plan this"
- The user describes a feature and says "write a plan"
- You hit a non-trivial change mid-task and need to step back before
  coding
- A `/specflow groom` pass surfaces a Ready item that needs design before
  implementation

Do **not** use when:

- The change is genuinely trivial (one-line typo, single-config bump) —
  just do it
- The user explicitly asked for the spec-kit flow (`/specflow specify` →
  `/specflow plan` produces design artefacts: research.md, data-model.md,
  contracts/, quickstart.md — that's a different beast for greenfield
  features with formal specs)

## Announce at start

> "I'm using the writing-plans skill to create the implementation plan."

## Save plans to

`docs/specflow/plans/YYYY-MM-DD-<feature-name>.md`

User preference overrides this default (some teams prefer `.specflow/plans/`
or `docs/plans/` — honor what they ask for). The date prefix gives plans
a natural chronological order in the directory listing.

## Scope check before writing

If the spec covers multiple independent subsystems — e.g. "add OAuth
**and** rewrite the billing engine **and** migrate to PostgreSQL" — STOP
and propose breaking it into separate plans. Each plan should produce
working, testable software on its own. A 3-subsystem plan is a backlog
Epic, not a single plan.

## File Structure section

Before defining tasks, the plan must include a **File Structure** section
that maps out which files will be created or modified. This is where
decomposition decisions get locked in.

- Design units with clear boundaries and well-defined interfaces. Each
  file should have one clear responsibility.
- Prefer smaller, focused files over large ones that do too much. You
  reason best about code you can hold in context at once.
- Files that change together should live together. Split by
  responsibility, not by technical layer.
- In existing Specflow code, follow established patterns. The hexagonal
  layout (`src/domain/`, `src/application/`, `src/infrastructure/`,
  `src/cli/`) is the house style — don't unilaterally restructure.

The File Structure table informs task decomposition. Each task should
produce self-contained changes that make sense independently.

## Bite-sized task granularity

**Each step is one action (2–5 minutes):**

- "Write the failing test" — one step
- "Run it to make sure it fails" — one step
- "Implement the minimal code to make the test pass" — one step
- "Run the tests and make sure they pass" — one step
- "Commit" — one step

A step that says "implement the feature" is too big. Break it down.

## Plan document header

Every plan **MUST** start with this header:

````markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `specflow:subagent-driven-development` (recommended) or
> `specflow:executing-plans` to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2–3 sentences about approach — what changes, what stays]

**Tech Stack:** [Deno + TypeScript, specific Specflow modules touched]

> Issue: [URL if applicable]

---
````

## Task structure

Each task lists its files, then walks through TDD-style steps with
**complete code blocks**. Example:

````markdown
### Task N: [Component Name]

**Files:**

- Create: `src/exact/path/to/file.ts`
- Modify: `src/exact/path/to/existing.ts:123-145`
- Test: `tests/exact/path/to/test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
Deno.test("specific behaviour", () => {
  const result = myFunction(input);
  assertEquals(result, expected);
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
deno test tests/path/to/test.ts
```

Expected: FAIL with `myFunction is not defined`.

- [ ] **Step 3: Write the minimal implementation**

```typescript
export function myFunction(input: Input): Output {
  return expected;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
deno test tests/path/to/test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/path/to/test.ts src/path/to/file.ts
git commit -m "feat(domain): add myFunction"
```
````

## No placeholders — these are plan failures

Every step must contain the actual content an engineer needs. **Never**
write:

- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling" / "add validation" / "handle edge cases"
- "Write tests for the above" (without showing the actual test code)
- "Similar to Task N" (repeat the code — the reader may be reading tasks
  out of order)
- Steps that describe what to do without showing how (code blocks are
  required for code steps)
- References to types, functions, or methods not defined in any task

If a step would have a placeholder, you don't understand the change well
enough yet — back up, research, then write the step with real content.

## Self-review

After writing the complete plan, look at it with fresh eyes. **Run this
checklist yourself — it is not a subagent dispatch.**

1. **Spec coverage** — skim each requirement in the spec / issue. Can
   you point to a task that implements it? List any gaps. If a
   requirement has no task, add the task.

2. **Placeholder scan** — search the plan for red flags from the
   "No placeholders" list above. Fix every one.

3. **Type consistency** — do the types, method signatures, and property
   names you used in later tasks match what you defined in earlier
   tasks? A function called `clearLayers()` in Task 3 but
   `clearFullLayers()` in Task 7 is a bug.

4. **Specflow conventions** — do file paths follow the hexagonal
   layout? Do you respect the byte-identity plugin-sync contract
   (`templates/core/...` plus `plugin/...` twin) for any new template
   files? Are manifest entries added if you scaffold new files?

5. **Smoke / audit** — if you touched any scaffolded skill or script,
   does the plan include a step to update
   `.claude/skills/test-sandbox/scripts/smoke-*.sh` and re-run
   `audit.sh`?

Fix issues inline. No need to re-review — just fix and move on.

## Execution handoff

After saving the plan, offer the user a choice of execution strategy:

> "Plan complete and saved to `docs/specflow/plans/<filename>.md`. Two
> execution options:
>
> 1. **Subagent-Driven** (recommended) — I dispatch a fresh subagent per
>    task with two-stage review (spec compliance + code quality). Catches
>    bugs early.
> 2. **Inline Execution** — Execute tasks in this session with
>    checkpoints. Faster for simple plans.
>
> Which approach?"

**If subagent-driven chosen:**

- **REQUIRED SUB-SKILL:** Use `specflow:subagent-driven-development`
- Fresh subagent per task + spec compliance + code quality review loop

**If inline chosen:**

- **REQUIRED SUB-SKILL:** Use `specflow:executing-plans`
- Sequential in-session execution with checkpoint pauses between tasks

## Key principles

- **Exact file paths** always — `src/domain/x.ts:42`, not "the x module"
- **Complete code** in every step — if a step changes code, show the code
- **Exact commands** with expected output — `deno test path/to/file.ts`,
  not "run the tests"
- **DRY** — don't repeat boilerplate across tasks, but **do** repeat code
  if a reader might jump straight to that task
- **YAGNI** — don't plan capabilities the issue didn't ask for
- **TDD** — every code-producing task starts with a failing test
- **Frequent commits** — one commit per logical step, not per task

## Out of scope

This skill writes **plans**, not code. It hands off execution to
`subagent-driven-development` or `executing-plans` (or to the user, if
they prefer to drive manually). It does not:

- Run tests itself
- Open branches or PRs
- Mutate the backlog (the `product-owner` agent owns those mutations)
- Trigger releases (that's `/release` / `devops-sre`)

## Integration with `/specflow plan`

This skill is **distinct from** the `/specflow plan` phase of the
spec-kit pipeline. The spec-kit `/specflow plan` produces design
artefacts (research.md, data-model.md, contracts/, quickstart.md) for
greenfield features starting from a `spec.md`. This `writing-plans`
skill produces a **single executable plan file** for issue-driven or
ad-hoc work where the spec-kit ceremony would be overkill.

A user can use both:

- `/specflow specify` → `/specflow plan` for a new multi-month feature
  with formal contracts
- `writing-plans` (auto-invoked) for "plan how to fix this backlog issue"

Specflow ships both because real teams have both flows.
