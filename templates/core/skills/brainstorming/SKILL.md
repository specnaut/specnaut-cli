---
name: brainstorming
description: Use when the user has an idea, feature request, or rough requirement that is NOT yet ready to plan — when the spec needs to be discovered through clarifying questions before any planning. Trigger phrases include "I want to build X", "I have an idea for Y", "let's brainstorm Z", "design how we should do W", "spec out V before we plan it". Asks questions one at a time, proposes 2-3 approaches, presents a design for approval, then hands off to writing-plans.
---

# Brainstorming

Help turn ideas into fully formed designs and specs through natural
collaborative dialogue. Start by understanding the current project
context, then ask questions **one at a time** to refine the idea. Once
you understand what's being built, present the design and get user
approval. Then hand off to `writing-plans`.

> Inspired by [obra/superpowers v5.1.0](https://github.com/obra/superpowers)
> (MIT) — `skills/brainstorming/SKILL.md`. Re-implemented for Specflow
> with explicit handoff to the bundled `writing-plans` skill and
> coexistence with the spec-kit `/specflow specify` flow.

## When to use this skill

Use when:

- The user describes an idea without enough detail to plan ("I want to
  add OAuth")
- The user pastes a vague issue title and says "design this"
- A backlog item is in `Backlog` with a `## Why` but no clear `## AC`
  yet — brainstorming clarifies the AC
- You're about to invoke `writing-plans` but the spec is too vague to
  write a plan without guessing

Do **not** use when:

- The user already has a clear spec or issue body with concrete AC —
  go straight to `writing-plans`
- The work is a one-line fix — just do it
- The user explicitly asked for the spec-kit greenfield flow (use
  `/specflow specify` instead — that's a heavier ceremony that
  produces `.specflow/specs/<feature>/spec.md` for multi-month
  features)

## Announce at start

> "I'm using the brainstorming skill to design this before we plan."

## The hard rule

**No implementation, no plan, no scaffolding until a design has been
presented AND the user has approved it.** This applies to EVERY idea
regardless of perceived simplicity. The design can be short (a few
sentences for truly small ideas) but you MUST present it and get
explicit approval before handing off to `writing-plans`.

The most common failure mode is "this is too simple to need a design"
— that's where unexamined assumptions cause the most rework. Run the
process even when it feels overkill; truncate the depth, not the
discipline.

## The process

### Step 1 — explore project context first

Before asking the user anything:

- Read recent commits with `git log --oneline -20`
- Check `AGENTS.md` and `.specflow/memory/constitution.md` for project
  principles
- Skim the existing skill / agent registry via `using-specflow` if not
  already loaded
- Look at the directory structure relevant to the idea

This makes your questions specific to the project, not generic.

### Step 2 — assess scope

If the idea describes multiple independent subsystems ("add OAuth AND
rewrite the billing engine AND migrate the database"), STOP and propose
breaking it into separate brainstorming sessions, one per subsystem.
Each session produces its own spec → plan → implementation cycle. A
3-subsystem idea is an Epic, not a single design.

### Step 3 — ask clarifying questions, ONE at a time

Ask the user one question at a time. Don't batch. Prefer multiple-choice
when possible ("would the auth state live in cookies or in the user
table?"), open-ended only when the choice space is too large.

Aim to understand:

- **Purpose** — what user problem does this solve?
- **Success criteria** — how do we know the feature works? what does
  the user see / do differently after?
- **Constraints** — performance, security, backward-compat, deployment
  story
- **Out of scope** — what's tempting but explicitly NOT in this design?

If a topic needs more depth, follow up with one more question. Don't
move on until you understand.

### Step 4 — propose 2–3 approaches with trade-offs

Once the goal is clear, propose 2–3 distinct approaches conversationally:

```
I see three ways to do this:

1. <Approach A> — pros / cons / fit
2. <Approach B> — pros / cons / fit
3. <Approach C> — pros / cons / fit

I'd recommend <A> because <reasoning>. Does that match your instinct?
```

Lead with your recommendation. The user picks (or proposes a fourth).

### Step 5 — present the design, section by section

Present the design in sections, scaled to their complexity (a few
sentences for simple ideas, ~200–300 words per section for nuanced
ones). After each section, confirm the user agrees before moving on.

Sections to cover (truncate when irrelevant):

- **Goal** — one sentence
- **Architecture** — which subsystems change, how they integrate
- **Components / files** — concrete file paths and responsibilities
- **Data model** — entities, relationships, state transitions (if
  applicable)
- **Error handling** — failure modes and how they surface
- **Testing strategy** — what tests verify the design works
- **Migration / rollback** — if the design changes existing behavior
- **Out of scope** — what we explicitly aren't doing

### Step 6 — design for isolation and clarity

For each file / component, you should be able to answer in one sentence:

- **What does it do?**
- **How do you use it?**
- **What does it depend on?**

If you can't, the boundaries need work — iterate before handing off.

Working in existing Specflow code, follow established patterns
(hexagonal layout, byte-identity plugin sync, etc.). If existing code
in the touch area has real problems that affect the work, include
targeted improvements as part of the design — but don't propose
unrelated refactoring.

### Step 7 — write the design doc + commit

Save the validated design (spec) to a location appropriate for the
project:

- **Greenfield spec-kit features** — `.specflow/specs/<feature-id>/spec.md`
  (this is the spec-kit convention; `/specflow specify` lives in this
  same space)
- **Issue-driven brownfield work** — `docs/specflow/specs/YYYY-MM-DD-<topic>.md`
  (mirror of the `docs/specflow/plans/` convention used by `writing-plans`)
- **Backlog item refinement** — update the issue body in-place (the
  PO agent owns this mutation; dispatch the PO to rewrite the issue
  body with the agreed design)

Commit the design doc to git so the discussion is durable.

### Step 8 — quick self-review

Look at the spec doc with fresh eyes:

1. **Placeholder scan** — any "TBD" / "TODO" / vague requirements? Fix
2. **Internal consistency** — do sections contradict each other?
3. **Scope check** — is this focused enough for a single
   implementation plan, or does it need decomposition?
4. **Ambiguity check** — could any requirement be interpreted two
   ways? If so, pick one and make it explicit.

Fix issues inline.

### Step 9 — user reviews the written spec

After the spec doc is written:

> "Spec written and committed to `<path>`. Please review it. Let me
> know if you want to make any changes before we move to writing the
> implementation plan."

Wait for explicit user approval. If they request changes, make them
and re-run the self-review. Only proceed once approved.

### Step 10 — hand off to `writing-plans`

After spec approval, invoke `writing-plans` with the spec as input.
The plan inherits the design's structure (architecture, file
structure, components) and breaks it into bite-sized TDD-style tasks.

```
> "Spec approved. Invoking writing-plans to produce the executable
>  plan..."
```

Do **NOT** invoke any other skill at this terminal handoff (not
`subagent-driven-development` directly, not `executing-plans`, not
implementation code). `writing-plans` is the next step.

## Key principles

- **One question at a time** — don't overwhelm
- **Multiple-choice preferred** — easier to answer than open-ended
- **YAGNI ruthlessly** — remove unnecessary features from all designs
- **Explore alternatives** — always 2–3 approaches before settling
- **Incremental validation** — present, get approval, move on
- **Be flexible** — go back when something doesn't make sense

## Coexistence with `/specflow specify`

Specflow has TWO entry points for design work:

| Entry | Use when |
|---|---|
| `brainstorming` skill (this) | Issue is vague, idea is fresh, design needs discovery via clarifying questions. Produces a markdown spec doc and hands off to `writing-plans`. |
| `/specflow specify` (spec-kit) | Greenfield multi-week feature with formal contracts. Produces `.specflow/specs/<feature>/spec.md` + auto-chains to `/specflow plan` (research, data-model, contracts, quickstart artefacts). |

If you're not sure which to use: start with `brainstorming`. If the
discussion reveals the design needs spec-kit ceremony (formal contracts,
data model, quickstart), hand off to `/specflow specify` instead of
`writing-plans` at Step 10.

## Out of scope

This skill does not:

- Write the plan (`writing-plans` does)
- Implement anything (the implementer agent does)
- Mutate the backlog (`product-owner` agent does, when refining
  backlog item bodies)
- Run any code or tests (this is design-only)

## When NOT to use this skill

- For purely tactical decisions inside a known plan ("which test
  framework?") — that's a one-question clarification, not a design
- For trivial single-file changes — just do them
- When the user explicitly said "skip the design, just implement" —
  honor the user (but log that you skipped the discipline)
