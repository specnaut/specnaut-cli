
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

The PO must respect the column model: items in `Backlog` need more
information / sizing / prioritisation; items in `Ready` are picked up by
development. The PO never auto-promotes from `Ready` to `In progress`.

The PO will:

- Read each item's body and existing comments.
- **Skip** items it has already commented on in a previous run (look for
  the marker `🤖 specflow-groom` at the start of any comment).
- For each remaining item:
  - **Rewrite the body when it's poorly worded.** If the description is
    missing, incomplete, or unclear, the PO MUST rewrite it in the
    standard `## Why` / `## Acceptance criteria` / `## Out of scope` /
    `## Notes` shape, using correct business and technical vocabulary
    so the result is readable by a developer or a future PO who has no
    prior context.
  - **Assign a size label.** Apply exactly one of `size:XS`, `size:S`,
    `size:M`, `size:L`, `size:XL`. T-shirt scale rationale:
    - `XS` — < 1 hour, trivial doc / config tweak
    - `S` — 1–4 hours, single-file or single-test change
    - `M` — half-day to a day, one subsystem touched, tests included
    - `L` — multi-day, crosses subsystems, requires a plan
    - `XL` — multi-PR effort; consider splitting into sub-tickets
  - **Assign a priority label.** Apply exactly one of `priority:P0`,
    `priority:P1`, `priority:P2`, `priority:P3`:
    - `P0` — incident / blocker; drop everything
    - `P1` — must-have for the next sprint or release
    - `P2` — important but deferrable; standard work
    - `P3` — nice-to-have / long horizon; pick up when slack appears
  - **Promote to `Ready`** when the body is clear AND both labels are
    applied AND no scope decisions remain.
  - **Leave a clarification comment** marked with the `🤖 specflow-groom`
    prefix when 1–3 scope decisions still need Kevin's input. Apply
    size + priority anyway (best estimate from available context). The
    item stays in `Backlog` until Kevin replies.
  - **Recommend closure** if the item is genuinely stale or duplicates a
    closed ticket — leave a comment recommending `not_planned`. Do not
    close autonomously.

The PO must respect the standard backlog skill — do not bypass its
scripts.

#### Label management

Size and priority labels are scoped to the repo. Before assigning a
label, the PO MUST ensure it exists:

- **GitHub backend** (`gh`):
  - `gh label list --repo <owner>/<repo>` to enumerate existing labels.
  - `gh label create "<name>" --color <hex> --description "<desc>" --repo <owner>/<repo>`
    to create one if absent. Suggested colors:
    - `size:XS` `#c2e0c6` · `size:S` `#bfdadc` · `size:M` `#bfd4f2` · `size:L` `#d4c5f9` · `size:XL` `#f9d0c4`
    - `priority:P0` `#b60205` · `priority:P1` `#d93f0b` · `priority:P2` `#fbca04` · `priority:P3` `#0e8a16`
  - `gh issue edit <num> --add-label "size:M" --add-label "priority:P2" --repo <owner>/<repo>`
    to apply (use `--remove-label` to swap a previously-assigned label
    when re-grooming).

- **GitLab backend** (`glab`): same flow with `glab label list` /
  `glab label create -n <name> --color "#hex" --description "<desc>"` /
  `glab issue update <num> --label "size:M,priority:P2"`.

- **Local markdown backend**: when the local backend ships support for
  the 5-column model (tracked in #130), size and priority will be
  applied as front-matter or inline markers per that ticket's
  convention. Until then, the local backend has no column model and
  this groom phase is a no-op for it (the PO should report
  "skipped — local backend predates the column model").

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
            <R> body rewrites, <S> sized, <Z> prioritised
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
