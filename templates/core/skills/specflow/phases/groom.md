
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
- **Process tickets one at a time, end-to-end** — body → size → priority
  → promote/comment, fully complete on ticket N before moving to N+1.
  Do NOT batch-clarify-then-batch-label across all tickets; the
  per-ticket loop must close labelling before the PO can consider a
  ticket "done for this run". Batched labelling-as-an-afterthought is
  the failure mode this contract exists to prevent.
- For each remaining item, the loop is a strict 4-step sequence and **a
  ticket is NOT considered processed until both labels are applied**:

  1. **Rewrite the body when it's poorly worded.** If the description is
     missing, incomplete, or unclear, the PO MUST rewrite it in the
     standard `## Why` / `## Acceptance criteria` / `## Out of scope` /
     `## Notes` shape, using correct business and technical vocabulary
     so the result is readable by a developer or a future PO who has no
     prior context.
  2. **Assign a size value.** Apply exactly one of `XS`, `S`, `M`, `L`, `XL`.
     T-shirt scale rationale:
     - `XS` — < 1 hour, trivial doc / config tweak
     - `S` — 1–4 hours, single-file or single-test change
     - `M` — half-day to a day, one subsystem touched, tests included
     - `L` — multi-day, crosses subsystems, requires a plan
     - `XL` — multi-PR effort; consider splitting into sub-tickets
  3. **Assign a priority value.** Apply exactly one of `P0`, `P1`, `P2`, `P3`:
     - `P0` — incident / blocker; drop everything
     - `P1` — must-have for the next sprint or release
     - `P2` — important but deferrable; standard work
     - `P3` — nice-to-have / long horizon; pick up when slack appears
  4. **Decide the outcome:**
     - **Promote to `Ready`** when the body is clear, both labels are
       applied, AND no scope decisions remain.
     - **Leave a clarification comment** marked with the `🤖 specflow-groom`
       prefix when 1–3 scope decisions still need Kevin's input. Steps 2
       and 3 are still mandatory — apply best-estimate labels from
       available context; the item stays in `Backlog` until Kevin
       replies.
     - **Recommend closure** if the item is genuinely stale or
       duplicates a closed ticket — leave a comment recommending
       `not_planned`. Steps 2 and 3 are still mandatory (apply labels
       reflecting the recommendation, e.g. `priority:P3`). Do not close
       autonomously.

  **Mandatory sizing + priority contract.** Steps 2 and 3 are NOT
  optional and NOT discretionary — every ticket the PO touches in a
  groom run MUST exit with both a size and a priority value persisted,
  regardless of the outcome chosen at step 4. If persistence fails for
  an external reason (the user lacks scope, the API rate-limited, etc.),
  the PO MUST capture the failure reason and surface it under "⚠ size /
  priority missing" in the final report — silent skip is a contract
  violation.

The PO must respect the standard backlog skill — do not bypass its
scripts.

#### How size and priority are persisted (field-first, label fallback)

Size and priority are conceptually two single-select dimensions. They
can live on a ticket in two surfaces:

1. **Native Project V2 single-select fields** named `Priority` and
   `Size`. Every Specflow project ships with these as the canonical
   surface — they group on the project board, query cleanly via
   GraphQL, and don't pollute the label namespace.
2. **GitHub / GitLab labels** (`priority:P0..P3`, `size:XS..XL`). Used
   as a fallback when the project does not have native fields, or when
   the value has no matching native option (only known case today:
   `priority:P3` on a 3-level field). Also used by the local Markdown
   backend, which has no native fields at all.

**Field wins.** If a native field exists for the dimension, write to
the field. Do NOT also apply the label — double-writing creates drift.

##### GitHub backend

Use the bundled scripts at `.specflow/scripts/backlog/`:

- `detect-fields.sh` — emits eval-friendly env lines listing the
  `Priority` / `Size` field IDs and option IDs (case-insensitive name
  match). Run **once per groom run**, not per ticket.
- `set-field.sh <issue> <Priority|Size> <value>` — writes the field if
  present. Exit codes:
  - `0` → wrote the field, do not apply a label for this dimension.
  - `10` → no such native field (e.g. user added neither `Priority` nor
    `Size` to their project). Caller MUST apply the corresponding label
    (`priority:P2` / `size:M`) instead.
  - `11` → field exists but the value option is missing (only
    `priority:P3` today). Caller MUST apply the matching label.
  - `12` → issue is not on the project. Caller MUST report the
    discrepancy under "⚠ size / priority missing" — neither path can
    persist the value.

**Label fallback** (for exit code `10` / `11` only):

- `gh label list --repo <owner>/<repo>` to enumerate existing labels.
- `gh label create "<name>" --color <hex> --description "<desc>" --repo <owner>/<repo>`
  to create one if absent. Suggested colors:
  - `size:XS` `#c2e0c6` · `size:S` `#bfdadc` · `size:M` `#bfd4f2` · `size:L` `#d4c5f9` · `size:XL` `#f9d0c4`
  - `priority:P0` `#b60205` · `priority:P1` `#d93f0b` · `priority:P2` `#fbca04` · `priority:P3` `#0e8a16`
- `gh issue edit <num> --add-label "size:M" --add-label "priority:P2" --repo <owner>/<repo>`
  to apply (use `--remove-label` to swap a previously-assigned label
  when re-grooming).

##### GitLab backend

GitLab does not yet have a parallel `set-field.sh` helper; the PO
applies scoped labels directly: `glab label list` / `glab label create
-n <name> --color "#hex" --description "<desc>"` / `glab issue update
<num> --label "size:M,priority:P2"`.

##### Local Markdown backend

When the local backend ships support for the 5-column model (tracked
in #130), size and priority will be applied as front-matter keys
(`priority:` and `complexity:`) per that ticket's convention. Until
then, the local backend has no column model and this groom phase is a
no-op for it (the PO should report "skipped — local backend predates
the column model").

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

End with a single summary block. **The per-ticket lines and the
size/priority-missing escalation block are mandatory contract output,
not optional** — they are how the user verifies the sizing + priority
contract was honoured.

Per-ticket lines should note when a value was persisted as a label
fallback rather than a native field — typically because the project
has no `Priority` / `Size` field, or because `priority:P3` does not
match a 3-level field. This makes the field-vs-label routing visible
in the report.

```
specflow-groom report
─────────────────────
⚠  groom completed with <K> un-sized/un-prioritised tickets — re-run or fix manually
    (only emitted when K > 0, at the very top of the summary)

Backlog:    <N> items reviewed, <P> promoted to Ready, <C> awaiting clarification
            <R> body rewrites, <S> sized, <Z> prioritised

Per-ticket:
  ↳ #<num> "<short title>" → promoted/comment/closure-recommended
       size=<X> + priority=<P> (field)
  ↳ #<num> "<short title>" → comment
       size=<X> (field) + priority=P3 (label fallback — no native option)
  ↳ ...

⚠ size / priority missing:
  ↳ #<num> "<short title>" — <reason: e.g. gh label create failed (rate-limited)>
  ↳ ...
  (omit this whole section when K == 0)

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
