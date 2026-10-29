# groom — board and delivery hygiene

Read `docs/constitution.md` before anything else: it is this project's binding rules, and no agent edits it unasked.

Keeps the backlog and delivery pipeline flowing without human intervention.
Reachable as **`/task groom`** — the only door.

**Owned by `/task`** — see "Which skill owns what" in `SKILL.md`. Orphan
**spec** detection is not owned here; step 4 says where it lives and runs it.

Auto-invocable: the router advertises "groom the backlog" and "run a hygiene
pass", and this file honours them. Also invoked explicitly, or scheduled with
`/loop 1h /task groom`.

## What this pass does

A grooming pass runs four independent checks. Each is delegated to the
right subagent so this skill stays small and the heavy lifting is owned
by the agent that has the right tools and prompt for the job.

### 1. Backlog grooming

Dispatch the **`product-owner`** subagent to groom the items in the board's
intake column. **Grooming ends with a promotion** — the rule is in the PO's own
`/task groom` contract; name it in the dispatch, do not restate it here.

**Resolve the columns once per run** (GitHub: `groom-columns.sh`). Exit `0`
prints `INTAKE` / `READY` (`PROMOTE=no`: the user chose not to promote — report
it). Exit `4`: ask the user **once**, a selection from `OPTIONS` — an existing
column, add the missing one to the Status field and re-run, or no promotion —
and persist it: `groom-columns.sh --set ready_column <column|none>`. Exit `13`:
board unread — promote nothing, report it. GitLab's `Status::*` labels come
from `ensure-labels.sh`; the local backend has no columns.

Epic and sub-task hygiene — orphaned children, parents due to close, sub-tasks
that escaped a closed epic — is part of this dispatch and is specified in the
`product-owner` agent's contract. Do not restate those rules here, and do not
assume a run covered them unless the PO reports on them.

The PO will:

- Read each item's body and existing comments.
- **Skip** items it has already commented on in a previous run (look for
  the marker `🤖 specnaut-groom` at the start of any comment).
- **Process tickets one at a time, end-to-end** — body → size → priority
  → promote/comment, fully complete on ticket N before moving to N+1.
  Do NOT batch-clarify-then-batch-label across all tickets; the
  per-ticket loop must close labelling before the PO can consider a
  ticket "done for this run". Batched labelling-as-an-afterthought is
  the failure mode this contract exists to prevent.
- For each remaining item, the loop is a strict 4-step sequence. **What a
  processed ticket must carry is decided by
  `.specnaut/scripts/bash/groom-rules.sh`** — its header is the rule, and
  `groom-verify.sh` checks it at the end of the run (see "Before the report").
  The steps below are how the PO satisfies it:

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
  3a. **Set Roadmap dates — soft, and only if the board has the fields.**
     GitHub backend only. Date / Estimate are *optional* Project V2 fields the
     user adds themselves; a board carrying only `Status` / `Priority` / `Size`
     is ordinary, not misconfigured. **Gate first** on the once-per-run
     `detect-fields.sh`, which emits `TARGETDATE_FIELD_ID=` /
     `STARTDATE_FIELD_ID=` / `ESTIMATE_FIELD_ID=` **empty** when the field is
     absent:
     - **Both IDs empty → skip this step entirely.** Set nothing, warn nothing,
       omit the "⚠ Roadmap dates missing" section. Never report a value as
       unset when it cannot be set at all.
     - **Field present** — `set-field.sh <num> TargetDate <YYYY-MM-DD>` on
       Backlog → Ready (best-estimate delivery date), `StartDate` on
       Ready → In Progress (today), `Estimate <N>` optional. A missing *value*
       on a field that exists never blocks: it emits a `⚠ no target date set`
       / `⚠ no start date set` line in the final report and the run moves on.
  4. **Decide the outcome:**
     - **Promote to the ready column** (`move.sh <num> "$READY"`) when the
       body is clear, both labels are applied, AND no scope decisions remain.
       A failed move goes in the report with its reason.
     - **Leave a clarification comment** marked with the `🤖 specnaut-groom`
       prefix when 1–3 scope decisions still need the user's input. Steps 2
       and 3 are still mandatory — apply best-estimate labels from
       available context; the item stays in the intake column
       until the user replies.
     - **Recommend closure** if the item is genuinely stale or
       duplicates a closed ticket — leave a comment recommending
       `not_planned`, with the same `🤖 specnaut-groom` prefix. Steps 2 and 3 are still mandatory (apply labels
       reflecting the recommendation, e.g. `priority:P3`). Do not close
       autonomously.

  **Mandatory sizing + priority contract.** Steps 2 and 3 are NOT
  optional and NOT discretionary, whatever the outcome chosen at step 4
  — what counts as persisted is `groom-rules.sh`'s to say, not this
  list's. If persistence fails for an external reason (the user lacks
  scope, the API rate-limited, etc.), the PO MUST capture the failure
  reason and surface it under "⚠ size / priority missing" in the final
  report — silent skip is a contract violation.

The PO must respect the standard backlog skill — do not bypass its
scripts.

#### How size and priority are persisted (field-first, label fallback)

Size and priority are conceptually two single-select dimensions. They
can live on a ticket in two surfaces:

1. **Native Project V2 single-select fields** named `Priority` and
   `Size`. Every Specnaut project ships with these as the canonical
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

Use the bundled scripts at `.specnaut/scripts/backlog/`:

- `detect-fields.sh` — emits eval-friendly env lines listing the
  `Priority` / `Size` field IDs and option IDs (case-insensitive name
  match), plus `STARTDATE_FIELD_ID` / `TARGETDATE_FIELD_ID` /
  `ESTIMATE_FIELD_ID` — **empty when the board carries no such field**,
  which is the gate step 3a reads. Run **once per groom run**, not per
  ticket.

  **That is a sample, taken once** — `groom-report.md` says what it costs and
  requires you to disclose it.
- `set-field.sh <issue> <Priority|Size> <value>` — writes the field; its exit
  codes are in the PO's classification contract. `12` / `13` go under
  "⚠ size / priority missing"; only `10` / `11` fall back to a label.

**Label fallback** (exit `10` / `11` only) — `gh label list`, then
`gh label create "<name>" --color <hex> --description "<desc>"` if absent,
then `gh issue edit <num> --add-label …` (`--remove-label` to swap on a
re-groom). All `--repo <owner>/<repo>`. Suggested colors:

- `size:XS` `#c2e0c6` · `size:S` `#bfdadc` · `size:M` `#bfd4f2` · `size:L` `#d4c5f9` · `size:XL` `#f9d0c4`
- `priority:P0` `#b60205` · `priority:P1` `#d93f0b` · `priority:P2` `#fbca04` · `priority:P3` `#0e8a16`

##### GitLab backend

No `set-field.sh` helper: scoped labels via `glab`, per the PO's
classification contract.

##### Local Markdown backend

The local backend has the same five columns (`scripts/local/move.sh`).
Size and priority are front-matter keys, `size:` and `priority:`, which
`add.sh` writes empty: set each to exactly one value (`XS`–`XL`,
`P0`–`P3`) by editing the task file, then move the card to `Ready`.

### 2. Board drift — closed items outside Done

**github + gitlab backends only.** Run
`bash .specnaut/scripts/backlog/sweep-closed.sh --since 168` and report its
output verbatim, summary line included. The script's header documents what each
line means; do not restate it, or the two definitions will drift.

**Read-only — report, never move.** Correcting drift belongs to
`/task merge`, which already owns board mutations; a detector that also
mutates cannot be run freely on a schedule.

### 3. Stale PR surface

**Only when the project actually opens pull requests** — `/task merge` opens
none unless `--pr` is passed, so otherwise say the step does not apply rather
than reporting an empty section forever.

Where it applies: list open PRs waiting on review or CI for more than 48 hours,
so the user can decide whether to ping, close, or merge. Read-only; do not
mutate PRs.

### 4. Orphan specs — the pipeline inspected at rest

**Only when the project keeps its specs locally**, i.e. `.specnaut/specs/`
exists. Skip the step and say so otherwise; do not report an empty section.

**Read `phases/orphan-specs.md` and follow it.**
An instruction to load that file and execute it, not a pointer for the reader.
The walk stays there — naming it here twice makes one copy the half that rots.
Ownership says where the logic lives, not who may call it; saying only the
first is what left this check unreachable from anything scheduled.

The path is relative to the **task** skill, beside `phases/plan.md`; under
a harness that flattens phases into siblings, whatever it named that document.

Read-only, like the two checks above: never delete or modify a spec file.


**`<backlog-reference>`** below means a reference built per the
`backlog-reference-contract` skill: the number **and** the title, wrapped in a
backend-resolved link — never a bare `#<num>`. Read that contract for the format
and the degradation ladder; do not restate it here.


## Before the report — prove the groom

**The last step of the pass, after the four checks and before the report.**
Run it with every item backlog grooming processed in this run:

```bash
bash .specnaut/scripts/backlog/groom-verify.sh [--ready "$READY"] <num>...
```

`--ready` is the column `groom-columns.sh` resolved (`none` when
`PROMOTE=no`); without it, `Ready`. The script fetches each item and hands it
to `.specnaut/scripts/bash/groom-rules.sh`, the one definition of a complete
item — read its header, do not restate it here.

- **Exit `0`** — every item is complete.
- **Exit `1`** — one line per incomplete item, naming what it lacks. Fix what
  you can and re-run; each line still standing goes under "⚠ size / priority
  missing", verbatim, with the persistence failure behind it when you know
  it, and counts towards the report's `<K>`. Never report as groomed an item
  the script listed.
- **Exit `2`** — an item could not be read. The run is **not verified**: say
  so at the top of the report with the script's stderr, never a clean run.

A field a backend cannot expose is named in that backend's script header and
reads as missing, never as present — report such a line as what it is.

## Output format

End with a single summary block — read `groom-report.md` and follow it. The
per-ticket lines and the size/priority-missing escalation block are **mandatory
contract output, not optional**: they are how the user verifies the sizing and
priority contract was honoured.

## When NOT to use this skill

- For a single-item backlog clarification → invoke the `product-owner`
  subagent directly with the item number.
- For PR review on a specific PR → invoke `code-reviewer` /
  `security-expert` directly.
- For implementing a spec → invoke `/task implement` directly.
