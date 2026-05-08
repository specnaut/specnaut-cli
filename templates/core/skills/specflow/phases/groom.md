
# /specflow groom

A maintenance pass that keeps the project's backlog and review pipeline
flowing without human intervention. Designed to be invoked manually or
on a timer via `/loop`.

This skill is **manual-only** (`disable-model-invocation: true`) — it
should not auto-trigger on casual user prompts. The user invokes it
explicitly with `/specflow groom` or schedules it with
`/loop 1h /specflow groom`.

## What this skill does

A grooming pass runs three independent checks. Each is delegated to the
right subagent so this skill stays small and the heavy lifting is owned
by the agent that has the right tools and prompt for the job.

### 1. Backlog grooming

Dispatch the **`product-owner`** subagent to clarify any items currently
in the `Backlog` column (i.e. not yet promoted to `Ready`).

The PO will:

- Read each item's body and existing comments.
- **Skip** items it has already commented on in a previous run (look for
  the marker `🤖 specflow-groom` at the start of any comment).
- For each remaining item:
  - If the body is already clarified (Why / AC / Out of scope all present
    and concrete), promote to `Ready`.
  - If 1–3 scope decisions remain, leave a clarification comment marked
    with the `🤖 specflow-groom` prefix so subsequent runs skip it.
  - If the item is genuinely stale or duplicates a closed ticket, the PO
    can recommend closure with `not_planned` (but does not close
    autonomously — the recommendation lands as a comment).

The PO must respect the standard backlog skill — do not bypass its
scripts.

### 2. Stale PR surface

For each open PR on this repository, check whether it has been waiting
on review or CI for more than 48 hours. List them in the report so the
user can decide whether to ping, close, or merge.

This step is read-only; do not mutate PRs.

### 3. Orphan spec detection

Walk `.specflow/specs/` (if present) and surface any feature directory
that is missing the next expected artefact:

- Has `spec.md` but no `plan.md` → flag as "needs `/specflow plan`".
- Has `plan.md` but no `tasks.md` → flag as "needs `/specflow tasks`".
- Has `tasks.md` but no `installed` markers in commits → flag as
  "needs `/specflow implement`".

This is also read-only; never delete or modify spec files.

## Output format

End with a single summary block:

```
specflow-groom report
─────────────────────
Backlog:    <N> items reviewed, <P> promoted to Ready, <C> awaiting clarification
Stale PRs:  <S> open PRs idle > 48h
Orphan specs: <O> spec directories missing the next artefact

Next action: <one-line recommendation, or "no action needed">
```

If nothing needed action, say so explicitly. The point of the skill is
to be a **no-op when the project is healthy**.

## When NOT to use this skill

- For a single-item backlog clarification → invoke the `product-owner`
  subagent directly with the item number.
- For PR review on a specific PR → invoke `code-reviewer` /
  `security-auditor` directly.
- For implementing a spec → invoke `/specflow implement` directly.
