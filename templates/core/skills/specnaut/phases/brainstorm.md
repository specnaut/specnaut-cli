## User Input

```text
$ARGUMENTS
```

`$ARGUMENTS` is the rough idea to brainstorm. It may be vague ("something to
let users monitor agent runs from their phone"), a bare issue title, or
**empty** — if empty, open with a single question: "What do you want to
build? Describe it in a sentence or two, even roughly." Do not pick a topic
yourself.

## Purpose

`brainstorm` is the optional **step 0** of the spec-driven pipeline: the
entry point for when the user does NOT yet have a clear enough idea to write
a spec. It runs a collaborative discovery dialogue, turns the fuzzy idea into
an approved design brief, then hands that brief to `/specnaut specify` — which
owns writing the formal `.specflow/specs/<feature>/spec.md`.

Use this phase when the idea needs *discovery* before it can be specified.
When the user already has a clear brief, they invoke `/specnaut specify`
directly and skip this phase.

## Procedure

The discovery dialogue is already defined, in full, by the bundled
**`brainstorming` skill**. Do not duplicate it here.

1. **Run the `brainstorming` skill's discovery process.** Read the
   `brainstorming` skill (via the `Skill` tool, or read its `SKILL.md` if the
   platform cannot invoke it) and follow its **Steps 1–6**:
   - Step 1 — explore project context (`git log`, `AGENTS.md`,
     `.specflow/memory/constitution.md`, the relevant directory structure).
   - Step 2 — assess scope; if the idea spans multiple independent
     subsystems, propose splitting it into one brainstorm per subsystem
     (a multi-subsystem idea is an Epic, not one feature).
   - Step 3 — ask clarifying questions **one at a time**, multiple-choice
     where possible (purpose, success criteria, constraints, out of scope).
   - Step 4 — propose 2–3 approaches with trade-offs; lead with a
     recommendation.
   - Step 5 — present the design section by section, confirming each.
   - Step 6 — design for isolation and clarity.

2. **Get explicit design approval.** Honour the skill's hard rule: no
   handoff until the user has approved the design. The design may be short
   for small ideas, but it MUST be presented and approved.

## Terminal handoff — overridden for the spec-kit chain

The standalone `brainstorming` skill ends (its Steps 7–10) by writing its own
markdown design doc and forking to `writing-plans` **or** `/specnaut specify`.
Inside the `/specnaut` router this phase **overrides that ending**:

- **Do NOT** write a separate design doc and do **NOT** hand off to
  `writing-plans`. `/specnaut specify` is the next phase and it owns writing
  `.specflow/specs/<feature>/spec.md`, so a brainstorm-authored doc would only
  double up.
- Instead, distill the approved design into a concise **feature brief**
  (2–6 sentences capturing goal, the chosen approach, key constraints, and
  explicit out-of-scope items) and carry it forward as the input to
  `/specnaut specify`.

## Chain decision

`brainstorm` is a **chainable** phase. Its next phase is always `specify`
(in both the full and lite chain shapes).

- `CHAIN_MODE == auto` (default) or `continue` → after design approval,
  immediately invoke `/specnaut specify` with the distilled feature brief as
  its `$ARGUMENTS`. Emit `✓ brainstorm complete — proceeding to specify`.
  The chain then continues normally from `specify` (which applies its own
  lite/full shape heuristic).
- `CHAIN_MODE == off` (`--manual`) or `once` → stop after design approval.
  Print the approved feature brief and tell the user they can run
  `/specnaut specify "<brief>"` when ready. Do not auto-invoke `specify`.

## Notes

- This phase is design-only: it asks questions and produces a brief. It
  writes no spec, no plan, and no code — those belong to `specify` and the
  phases after it.
- Backlog mutations (e.g. refining a vague issue body into the agreed brief)
  go through the `product-owner` agent, never inline — consistent with the
  rest of the pipeline.
