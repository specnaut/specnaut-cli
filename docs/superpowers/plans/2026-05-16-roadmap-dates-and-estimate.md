# Roadmap dates & Estimate field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate GitHub Project #4's Start date, Target date, and Estimate fields from the PO
agent's grooming flow so the project's already-shipped Roadmap view becomes a live, always-current
timeline. Currently those fields are blank for every Specflow item.

**Architecture:** Surgical addition to the existing GitHub backlog-script trio (`detect-fields.sh`,
`set-field.sh`, PO contract). `detect-fields.sh` learns three new field types (`StartDate` +
`TargetDate` are `ProjectV2Field` of type `DATE`; `Estimate` is `ProjectV2Field` of type `NUMBER`).
`set-field.sh` gains three new axis names that route to `gh project item-edit --date` and `--number`
instead of `--single-select-option-id`. PO agent + groom phase docs gain a soft-axes section
describing when dates should be set and what warning to emit when they're missing. No new files, no
schema changes — additive extension to the #157/#161 infrastructure.

**Tech Stack:** Bash 4+ · `gh project field-list` (GraphQL projection) ·
`gh project item-edit --date|--number` (mutation) · existing `_config.sh` for `REPO_OWNER` /
`REPO_NAME` / `PROJECT_NUMBER` / `PROJECT_NODE_ID`.

> Issue: https://github.com/mkrlabs/specflow/issues/264

---

## Spec coverage map

| AC                                                                                                                               | Where it lands                             |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| (a) `set-field.sh` accepts `StartDate`, `TargetDate`, `Estimate`; writes via `gh project item-edit`; exit 10 if field absent     | Task 2                                     |
| (b) `detect-fields.sh` discovers field IDs at runtime, no-op when absent                                                         | Task 1                                     |
| (c) PO classification contract gains two soft axes (Start, Target) — recommended, not gated. Estimate stays optional.            | Task 3                                     |
| (d) Convention: Start date at Ready → In Progress; Target date at Backlog → Ready                                                | Task 3 (PO agent) + Task 4 (groom phase)   |
| (e) During grooming, missing Start/Target date on Ready or In Progress item → `⚠ no target/start date set` warning, non-blocking | Task 4 (groom phase output spec)           |
| (f) Smoke / regression test asserts new axis names accepted + correct flag shape                                                 | Task 5 (static-grep on scaffolded scripts) |
| (g) PO system prompt documents the new soft axes + conventions                                                                   | Task 3                                     |

Out of scope (do NOT touch): org-level issue-sidebar fields (those duplicate Project-level fields
and aren't read by Roadmap), auto-computation of Target from Estimate + sprint calendar, Roadmap
view configuration/sharing/export, the `local` Markdown backend, mandatory enforcement (dates must
NEVER block).

---

## File Structure

| File                                                            | Responsibility                                                                                                                                                                                               | Action     |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| `templates/core/skills/backlog/scripts/github/detect-fields.sh` | Discover `StartDate`, `TargetDate`, `Estimate` field IDs alongside existing `Priority` and `Size`. Emit `STARTDATE_FIELD_ID=…`, `TARGETDATE_FIELD_ID=…`, `ESTIMATE_FIELD_ID=…` env lines; empty when absent. | **Modify** |
| `templates/core/skills/backlog/scripts/github/set-field.sh`     | Accept three new axis names (`StartDate`, `TargetDate`, `Estimate`), route to `gh project item-edit --date` (dates) or `--number` (estimate). Same exit-10 graceful-fallback contract for missing fields.    | **Modify** |
| `templates/core/agents/product-owner.md`                        | Document the two new soft axes + when-to-set conventions. Update the classification table to mark Start/Target as recommended, Estimate as optional.                                                         | **Modify** |
| `plugin/agents/product-owner.md`                                | Byte-identical mirror (sync_pair in `tests/plugin/plugin_sync_test.ts`).                                                                                                                                     | **Modify** |
| `templates/core/skills/specflow/phases/groom.md`                | New soft-axes block in the grooming protocol + new `⚠ no target/start date set` line in the report-output template.                                                                                          | **Modify** |
| `plugin/skills/specflow/phases/groom.md`                        | Byte-identical mirror.                                                                                                                                                                                       | **Modify** |
| `.claude/skills/test-sandbox/scripts/smoke-backlog-github.sh`   | New static-grep assertions for the three axis names, the `--date` / `--number` flag wiring, and the three `_FIELD_ID` env emissions.                                                                         | **Modify** |

No new files. No manifest changes.

---

## Tasks

### Task 1: Extend `detect-fields.sh` for StartDate / TargetDate / Estimate

**Files:**

- Modify: `templates/core/skills/backlog/scripts/github/detect-fields.sh`

**Step 1**: Read the current script. The pattern is one `emit Priority PRIORITY` / `emit Size SIZE`
per single-select field, followed by `PROJECT_NODE_ID=…`. The existing `emit()` helper queries
`ProjectV2SingleSelectField`. Date and number fields are `ProjectV2Field` (type `DATE` / `NUMBER`),
so they need a different jq filter and a different output shape (no options array — just the field
ID).

**Step 2**: Add a sibling helper `emit_simple()` for non-single-select fields, then call it for the
three new fields. Replace the existing block (after the `emit Size SIZE` line, before
`# Project node ID — handy for callers`):

```bash
emit Priority PRIORITY
emit Size SIZE
```

with:

```bash
emit Priority PRIORITY
emit Size SIZE

# Date + number fields used by the Roadmap view (#264). They are
# regular ProjectV2Field nodes, not single-select — emit just the
# field ID; the writer routes by axis name to --date or --number.
emit_simple() {
  local field="$1" prefix="$2"
  local field_id
  field_id=$(echo "$FIELDS_JSON" | jq -r --arg n "$field" '
    .fields[]
    | select(.type == "ProjectV2Field")
    | select((.name | ascii_downcase) == ($n | ascii_downcase))
    | .id
  ')
  if [ -z "$field_id" ]; then
    echo "${prefix}_FIELD_ID="
    return
  fi
  echo "${prefix}_FIELD_ID=$field_id"
}

emit_simple "Start date"  STARTDATE
emit_simple "Target date" TARGETDATE
emit_simple "Estimate"    ESTIMATE
```

Notes:

- GitHub's canonical field names are **"Start date"** and **"Target date"** (with the space,
  case-insensitive). The script's case-insensitive match on `ascii_downcase` makes this robust.
- The `emit_simple()` helper is defined inline AT the call site (right before its three calls)
  rather than at the top of the file — keeps related code together for the reader. The existing
  `emit()` is still at the top because it serves Priority + Size.

**Step 3**: Confirm `set -euo pipefail` is preserved (top of file unchanged), and `_config.sh`
sourcing too.

**Step 4**: Manual sanity check — read the new file end-to-end:

```bash
cat templates/core/skills/backlog/scripts/github/detect-fields.sh
```

Expected: 7 emit calls total (2 single-select + 3 simple + the project node ID line). No new
top-level state, no `unset -v` calls, no `set` mutations.

**Step 5**: Run the bundle:

```bash
deno task bundle
```

Expected: `Bundled 86 core entries + 11 harness-specific → src/templates_bundle.ts`.

**Step 6**: Run the test suite:

```bash
deno task test
```

Expected: `644 passed | 0 failed`.

**Step 7**: Commit:

```bash
git add templates/core/skills/backlog/scripts/github/detect-fields.sh src/templates_bundle.ts
git commit -m "feat(backlog): detect-fields.sh discovers Roadmap field IDs

Adds three runtime discoveries to detect-fields.sh — StartDate (date),
TargetDate (date), and Estimate (number) — alongside the existing
Priority and Size single-select fields. Empty *_FIELD_ID values mean
the project doesn't have the field, and the caller (set-field.sh)
falls back to exit 10 just like the existing pattern. No hardcoded
field IDs; discovery via gh project field-list.

Refs #264 (AC b).
"
```

---

### Task 2: Extend `set-field.sh` for StartDate / TargetDate / Estimate

**Files:**

- Modify: `templates/core/skills/backlog/scripts/github/set-field.sh`

**Step 1**: Re-read the current script to confirm the existing axis-dispatch shape (lower-case
normalisation, IssueType early-exit, then `case "$FIELD_LOWER"` for priority/size).

**Step 2**: Extend the usage string in the script header to document the new axes. Replace:

```bash
# Usage: set-field.sh <issue-number> <Priority|Size|IssueType> <value>
#   Examples:
#     set-field.sh 42 Priority P1
#     set-field.sh 42 Size M
#     set-field.sh 42 IssueType Feature
```

With:

```bash
# Usage: set-field.sh <issue-number> <Priority|Size|IssueType|StartDate|TargetDate|Estimate> <value>
#   Examples:
#     set-field.sh 42 Priority    P1
#     set-field.sh 42 Size        M
#     set-field.sh 42 IssueType   Feature
#     set-field.sh 42 StartDate   2026-05-16
#     set-field.sh 42 TargetDate  2026-06-30
#     set-field.sh 42 Estimate    3
#
# Date axes accept ISO 8601 (YYYY-MM-DD). Estimate is a numeric value
# (story points or days, project's choice). Date / Estimate fields are
# part of the Project V2 board (#264); they're what the Roadmap view
# plots along its timeline.
```

**Step 3**: Update the usage-line error message at line 36 to match:

Replace:

```bash
echo 'usage: set-field.sh <issue-number> <Priority|Size|IssueType> <value>' >&2
```

With:

```bash
echo 'usage: set-field.sh <issue-number> <Priority|Size|IssueType|StartDate|TargetDate|Estimate> <value>' >&2
```

**Step 4**: Add a NEW dispatch block for the date + number axes, between the IssueType early-exit
(currently ending at line 78) and the existing `case "$FIELD_LOWER" in priority) ... size) ... *)`
block (line 80).

After the `fi` on line 78, insert:

```bash
# Date / number Project V2 fields (#264 — Roadmap inputs). They don't
# have option IDs — `gh project item-edit` takes the raw value via
# --date (ISO 8601) or --number. The field discovery still runs through
# detect-fields.sh; missing field → exit 10 (caller surfaces "field
# absent on project" warning, same contract as Priority/Size).
case "$FIELD_LOWER" in
  startdate | targetdate | estimate)
    case "$FIELD_LOWER" in
      startdate)  PREFIX="STARTDATE"  CANONICAL="Start date"  KIND="date" ;;
      targetdate) PREFIX="TARGETDATE" CANONICAL="Target date" KIND="date" ;;
      estimate)   PREFIX="ESTIMATE"   CANONICAL="Estimate"    KIND="number" ;;
    esac

    eval "$("$(dirname "$0")/detect-fields.sh")"

    FIELD_ID_VAR="${PREFIX}_FIELD_ID"
    FIELD_ID="${!FIELD_ID_VAR-}"
    if [ -z "$FIELD_ID" ]; then
      echo "no native '$CANONICAL' field on Project #$PROJECT_NUMBER — fall back to label or skip" >&2
      exit 10
    fi

    # Targeted item-ID lookup, same shape as the Priority/Size path
    # below — one issue, projectItems(first:5), filter on PROJECT_NODE_ID.
    ITEM_ID=$(gh api graphql -f query='
      query($owner:String!, $name:String!, $num:Int!) {
        repository(owner:$owner, name:$name) {
          issue(number:$num) {
            projectItems(first:5) { nodes { id project { id } } }
          }
        }
      }' -f owner="$REPO_OWNER" -f name="$REPO_NAME" -F num="$NUM" \
      | jq -r --arg p "$PROJECT_NODE_ID" '.data.repository.issue.projectItems.nodes[] | select(.project.id==$p) | .id' | head -1)

    if [ -z "$ITEM_ID" ]; then
      echo "issue #$NUM is not on Project #$PROJECT_NUMBER" >&2
      exit 12
    fi

    if [ "$KIND" = "date" ]; then
      gh project item-edit \
        --id "$ITEM_ID" \
        --project-id "$PROJECT_NODE_ID" \
        --field-id "$FIELD_ID" \
        --date "$VALUE" >/dev/null
    else
      gh project item-edit \
        --id "$ITEM_ID" \
        --project-id "$PROJECT_NODE_ID" \
        --field-id "$FIELD_ID" \
        --number "$VALUE" >/dev/null
    fi

    echo "✓ #$NUM $CANONICAL → $VALUE"
    exit 0
    ;;
esac
```

**Step 5**: The existing `case "$FIELD_LOWER" in priority) ... size) ... *)` block stays untouched —
it's reached only when the new axes don't match. The catch-all `*)` error message at line 84 should
be updated for completeness:

Replace:

```bash
*)
  echo "error: unsupported field '$FIELD_NAME' (Priority|Size|IssueType)" >&2
  exit 1
  ;;
```

With:

```bash
*)
  echo "error: unsupported field '$FIELD_NAME' (Priority|Size|IssueType|StartDate|TargetDate|Estimate)" >&2
  exit 1
  ;;
```

**Step 6**: Manual sanity check — read the entire script:

```bash
cat templates/core/skills/backlog/scripts/github/set-field.sh
```

Expected: ~190 lines total (was ~130). Header docstring updated, new dispatch block for date/number
axes, existing Priority/Size block intact, catch-all message updated.

**Step 7**: Run the bundle:

```bash
deno task bundle
```

Expected: `Bundled 86 core entries + 11 harness-specific → src/templates_bundle.ts`.

**Step 8**: Run the test suite:

```bash
deno task test
```

Expected: `644 passed | 0 failed`.

**Step 9**: Commit:

```bash
git add templates/core/skills/backlog/scripts/github/set-field.sh src/templates_bundle.ts
git commit -m "feat(backlog): set-field.sh writes Start/Target dates + Estimate

Adds three new axis names to set-field.sh (StartDate, TargetDate,
Estimate) routed to gh project item-edit --date / --number. Same
exit-10 graceful fallback as Priority/Size when the field is absent
from the project. ISO 8601 (YYYY-MM-DD) for dates; numeric for
Estimate. Lets the PO populate the inputs the Roadmap view reads.

Refs #264 (AC a).
"
```

---

### Task 3: Update the PO agent — soft axes + when-to-set conventions

**Files:**

- Modify: `templates/core/agents/product-owner.md`
- Modify: `plugin/agents/product-owner.md` (byte-identical mirror)

**Step 1**: Open `templates/core/agents/product-owner.md` and find the **Mandatory classification
contract** section (around line 36). The current text reads:

```markdown
## Mandatory classification contract — every created or clarified item

Classifying an item is part of grooming, not optional polish. Every backlog item you touch MUST exit
with **four hard axes + one soft** (see #5) persisted before your final report — a **gate**, not
polish:

1. **Size** — `XS`..`XL`
2. **Priority** — `P0`..`P3`
3. **Issue Type** — `Task` / `Bug` / `Feature`
4. **Label** — at least one classifying label (`enhancement`, `bug`, `documentation`, …)
5. **Bounded context** (soft) — `domain:<context>` label (e.g. `domain:checkout`). Optional on
   mono-domain projects, but the `## Domain Model` block in every brief MUST carry a
   `Bounded context:` field. Tickets touching ≥ 2 contexts → apply the "Epic detection heuristic"
   with reason "cross-bounded-context".

Persistence per backend:

- **GitHub** — use `set-field.sh <issue> <Priority|Size|IssueType> <value>`; exit `0` OK, `10`/`11`
  fall back to a label, `12` = issue not on project. Run `detect-fields.sh` once per groom. Never
  dual-write field + matching label.
- **GitLab** — scoped labels via `glab` (`priority::P1`, `size::M`, `type::feature`). Create on
  first use.
- **Local Markdown** — `priority:` / `complexity:` / `category:` frontmatter. No labels.

Persistence failures MUST appear as `⚠ classification incomplete` — a silent skip is a contract
violation.
```

Rewrite the opening line + add a new soft-axes group:

```markdown
## Mandatory classification contract — every created or clarified item

Classifying an item is part of grooming, not optional polish. Every backlog item you touch MUST exit
with **four hard axes + three soft** (see #5–#7) persisted before your final report — a **gate**,
not polish:

1. **Size** — `XS`..`XL`
2. **Priority** — `P0`..`P3`
3. **Issue Type** — `Task` / `Bug` / `Feature`
4. **Label** — at least one classifying label (`enhancement`, `bug`, `documentation`, …)
5. **Bounded context** (soft) — `domain:<context>` label (e.g. `domain:checkout`). Optional on
   mono-domain projects, but the `## Domain Model` block in every brief MUST carry a
   `Bounded context:` field. Tickets touching ≥ 2 contexts → apply the "Epic detection heuristic"
   with reason "cross-bounded-context".
6. **Target date** (soft, GitHub only) — set when promoting Backlog → Ready so the Roadmap view
   shows a planned end. ISO 8601 (`YYYY-MM-DD`). Missing on a Ready / In progress item →
   `⚠ no target date set` in the final report, never a block.
7. **Start date** (soft, GitHub only) — set when moving Ready → In Progress. ISO 8601. Missing on an
   In progress item → `⚠ no start date set` warning, never a block.

**Estimate** (story points or days; numeric Project V2 field) stays fully optional — set it if the
team uses point-based velocity, otherwise skip.

Persistence per backend:

- **GitHub** — use
  `set-field.sh <issue> <Priority|Size|IssueType|StartDate|TargetDate|Estimate> <value>`; exit `0`
  OK, `10`/`11` fall back to a label (only Priority/Size; dates and Estimate just skip), `12` =
  issue not on project. Run `detect-fields.sh` once per groom. Never dual-write field + matching
  label.
- **GitLab** — scoped labels via `glab` (`priority::P1`, `size::M`, `type::feature`). Date /
  Estimate axes are GitHub-only (Roadmap view); GitLab has no equivalent in this scope.
- **Local Markdown** — `priority:` / `complexity:` / `category:` frontmatter. No labels. Date /
  Estimate are not tracked on local backends (no Roadmap view to feed).

Persistence failures on hard axes MUST appear as `⚠ classification incomplete` — a silent skip is a
contract violation. Date axes are warn-only.
```

**Step 2**: Find any other place in the PO agent doc that lists `set-field.sh` arguments and update
them to include the new axes. Grep first:

```bash
grep -n "set-field" templates/core/agents/product-owner.md
```

Update every match to show `<Priority|Size|IssueType|StartDate|TargetDate|Estimate>`.

**Step 3**: Check the Windsurf 12000-char cap
(`tests/infrastructure/harness/windsurf_harness_test.ts`). Run:

```bash
wc -c templates/core/agents/product-owner.md
```

The PO agent currently renders at ~11900 chars (it was trimmed tight in #261). The additions above
add ~600 chars. The Windsurf harness adapter at `src/infrastructure/harness/windsurf_harness.ts`
strips ~200 chars; rendered size will exceed 12000.

**Trim contingency:** the closing-rules section (the bottom of the file, under `## Closing rules`)
was already trimmed in #261. If `wc -c` reports > 12000 source-chars, look for further trim targets
in this order:

1. The Tech-debt intake protocol prose can lose its parenthetical examples (~150 chars).
2. The "First action in every session" 4-step protocol can fold steps 1+2 into a single line (~80
   chars).
3. The local-backend Frontmatter schema YAML block at line 85-99 is duplicated in the SKILL.md —
   leave it but trim the surrounding prose (~100 chars).

Stop trimming as soon as `wc -c` reports ≤ 11900 source-chars (Windsurf rendered budget).

**Step 4**: Mirror byte-identically to the plugin twin:

```bash
cp templates/core/agents/product-owner.md plugin/agents/product-owner.md
```

The `tests/plugin/plugin_sync_test.ts` byte-identity check will fail at CI otherwise.

**Step 5**: Run the bundle + tests:

```bash
deno task bundle
deno task test
```

Expected: `644 passed | 0 failed`. The Windsurf cap test will fail if the source file is too large;
if so, trim and retry.

**Step 6**: Commit:

```bash
git add templates/core/agents/product-owner.md plugin/agents/product-owner.md src/templates_bundle.ts
git commit -m "feat(po): document Start/Target date + Estimate soft axes

Adds three soft classification axes to the PO agent contract:
- Target date (soft) — set Backlog → Ready
- Start date (soft) — set Ready → In Progress
- Estimate — fully optional

Soft means warn-on-missing, never block. Hard axes (Size / Priority /
Issue Type / label) and the existing Bounded-context soft axis stay
intact. set-field.sh usage in the doc gains the three new axis names
(StartDate / TargetDate / Estimate). GitLab and local backends are
explicitly out of scope for date axes — there's no Roadmap view to
feed.

Refs #264 (AC c, d, g).
"
```

---

### Task 4: Update the groom phase — soft warning surface

**Files:**

- Modify: `templates/core/skills/specflow/phases/groom.md`
- Modify: `plugin/skills/specflow/phases/groom.md` (byte-identical mirror)

**Step 1**: Open `templates/core/skills/specflow/phases/groom.md` and find the per-ticket lifecycle
protocol (around lines 38–80). Add a NEW step after step 3 (Priority assignment) and before step 4
(Decide outcome):

Find:

```markdown
3. **Assign a priority value.** Apply exactly one of `P0`, `P1`, `P2`, `P3`:
   - `P0` — incident / blocker; drop everything
   - `P1` — must-have for the next sprint or release
   - `P2` — important but deferrable; standard work
   - `P3` — nice-to-have / long horizon; pick up when slack appears
4. **Decide the outcome:**
```

Replace with:

```markdown
3. **Assign a priority value.** Apply exactly one of `P0`, `P1`, `P2`, `P3`:
   - `P0` — incident / blocker; drop everything
   - `P1` — must-have for the next sprint or release
   - `P2` — important but deferrable; standard work
   - `P3` — nice-to-have / long horizon; pick up when slack appears 3a. **Set Roadmap dates
     (soft).** GitHub backend only — Roadmap view inputs:
   - **Target date** when promoting Backlog → Ready (`set-field.sh <num> TargetDate <YYYY-MM-DD>`).
     Use a best-estimate planned-delivery date; revise when scope shifts.
   - **Start date** when moving Ready → In Progress (`set-field.sh <num> StartDate <YYYY-MM-DD>`).
     Today's date when picking up the work.
   - **Estimate** (optional) story-point or day count (`set-field.sh <num> Estimate <N>`). Missing
     dates do NOT block; they emit a warn-only line in the final report (see "⚠ no target/start date
     set" below).
4. **Decide the outcome:**
```

**Step 2**: Find the "Mandatory sizing + priority contract" paragraph (around lines 74–82) and
update the contract to mention the soft axes are warn-only:

Find:

```markdown
**Mandatory sizing + priority contract.** Steps 2 and 3 are NOT optional and NOT discretionary —
every ticket the PO touches in a groom run MUST exit with both a size and a priority value
persisted, regardless of the outcome chosen at step 4. If persistence fails for an external reason
(the user lacks scope, the API rate-limited, etc.), the PO MUST capture the failure reason and
surface it under "⚠ size / priority missing" in the final report — silent skip is a contract
violation.
```

Replace with:

```markdown
**Mandatory sizing + priority contract.** Steps 2 and 3 are NOT optional and NOT discretionary —
every ticket the PO touches in a groom run MUST exit with both a size and a priority value
persisted, regardless of the outcome chosen at step 4. If persistence fails for an external reason
(the user lacks scope, the API rate-limited, etc.), the PO MUST capture the failure reason and
surface it under "⚠ size / priority missing" in the final report — silent skip is a contract
violation.

Step 3a (Roadmap dates) is **soft** — never blocking. When the PO promotes Backlog → Ready or moves
Ready → In Progress, it SHOULD set the appropriate date; when it doesn't (because the date is
genuinely unknown), it surfaces a `⚠ no target date set` or `⚠ no start date set` line in the final
report and moves on.
```

**Step 3**: Find the report-output template (around lines 183–208) and add the new warning section.
The current template has a `⚠ size / priority missing:` block; add a parallel
`⚠ Roadmap dates missing:` block:

Find:

```
⚠ size / priority missing:
  ↳ #<num> "<short title>" — <reason: e.g. gh label create failed (rate-limited)>
  ↳ ...
  (omit this whole section when K == 0)
```

After that block, before the `Stale PRs:` line, insert:

```
⚠ Roadmap dates missing (GitHub backend, soft):
  ↳ #<num> "<short title>" — Ready since <date>, no target date set
  ↳ #<num> "<short title>" — In progress, no start date set
  ↳ ...
  (omit this whole section when no items in Ready / In progress lack
   their respective date)
```

**Step 4**: Mirror byte-identically to the plugin twin:

```bash
cp templates/core/skills/specflow/phases/groom.md plugin/skills/specflow/phases/groom.md
```

**Step 5**: Run the bundle + tests:

```bash
deno task bundle
deno task test
```

Expected: `644 passed | 0 failed`. The plugin-sync test will catch any drift between the two files.

**Step 6**: Commit:

```bash
git add templates/core/skills/specflow/phases/groom.md plugin/skills/specflow/phases/groom.md src/templates_bundle.ts
git commit -m "feat(groom): add Roadmap-dates step + soft-warning surface

Grooming protocol gains a step 3a between Priority assignment and the
outcome decision: PO sets Target date at Backlog → Ready, Start date
at Ready → In Progress, and optionally Estimate. All three are soft —
missing dates emit a warn-only line in the final report under the new
⚠ Roadmap dates missing section, parallel to the existing ⚠ size /
priority missing escalation but never blocking.

Refs #264 (AC d, e).
"
```

---

### Task 5: Smoke coverage in `smoke-backlog-github.sh`

**Files:**

- Modify: `.claude/skills/test-sandbox/scripts/smoke-backlog-github.sh`

The github smoke is static-grep — it inspects the scaffolded scripts in `.specflow/scripts/backlog/`
rather than invoking them against a live project. Add a new block parallel to the existing
`#157 + #161` block.

**Step 1**: Find the existing `#157 + #161` block in
`.claude/skills/test-sandbox/scripts/smoke-backlog-github.sh` (lines 56–67) and locate the end of
that block. After it, before the next `═══` block, insert:

```bash
echo
echo "═══ #264  Roadmap dates + Estimate (set-field/detect-fields) ═══"
check "set-field.sh usage advertises StartDate axis (#264)" \
  'grep -q "StartDate" .specflow/scripts/backlog/set-field.sh'
check "set-field.sh usage advertises TargetDate axis (#264)" \
  'grep -q "TargetDate" .specflow/scripts/backlog/set-field.sh'
check "set-field.sh usage advertises Estimate axis (#264)" \
  'grep -q "Estimate" .specflow/scripts/backlog/set-field.sh'
check "set-field.sh dispatches startdate/targetdate/estimate via case (#264)" \
  'grep -qE "startdate \| targetdate \| estimate" .specflow/scripts/backlog/set-field.sh'
check "set-field.sh wires --date for date axes (#264)" \
  'grep -qE "^[[:space:]]*--date " .specflow/scripts/backlog/set-field.sh'
check "set-field.sh wires --number for Estimate (#264)" \
  'grep -qE "^[[:space:]]*--number " .specflow/scripts/backlog/set-field.sh'
check "detect-fields.sh discovers StartDate field (#264)" \
  'grep -q "STARTDATE_FIELD_ID" .specflow/scripts/backlog/detect-fields.sh'
check "detect-fields.sh discovers TargetDate field (#264)" \
  'grep -q "TARGETDATE_FIELD_ID" .specflow/scripts/backlog/detect-fields.sh'
check "detect-fields.sh discovers Estimate field (#264)" \
  'grep -q "ESTIMATE_FIELD_ID" .specflow/scripts/backlog/detect-fields.sh'
check "detect-fields.sh queries ProjectV2Field for date/number fields (#264)" \
  'grep -q "ProjectV2Field" .specflow/scripts/backlog/detect-fields.sh'
check "PO agent advertises Target date soft axis (#264)" \
  'grep -q "Target date" .claude/agents/product-owner.md'
check "PO agent advertises Start date soft axis (#264)" \
  'grep -q "Start date" .claude/agents/product-owner.md'
check "groom phase mentions Roadmap dates step (#264)" \
  'grep -q "Roadmap dates" .claude/skills/specflow/phases/groom.md'
check "groom phase report surfaces Roadmap-dates-missing warning (#264)" \
  'grep -q "no target date set\|no start date set" .claude/skills/specflow/phases/groom.md'
```

**Step 2**: Run the smoke audit:

```bash
bash .claude/skills/test-sandbox/scripts/audit.sh
```

Expected: `0 coverage gap(s), 0 stale assertion(s)`. The audit's basename-substring scan picks up
`set-field.sh`, `detect-fields.sh`, and the doc paths.

**Step 3**: Run the github smoke locally — note: it requires a scaffolded project at
`/tmp/specflow-smoke-github` (or similar) per the existing test-sandbox convention. If the scaffold
doesn't exist on this machine, the smoke can't be exercised end-to-end; static-grep assertions are
validated at CI via the `cross-smoke` workflow against fresh scaffolds. Skip a local run if no
scaffold; the CI run gates the merge.

```bash
# Only if a recent scaffold exists at /tmp/specflow-smoke-github/
if [ -d /tmp/specflow-smoke-github/.specflow/scripts/backlog ]; then
  cd /tmp/specflow-smoke-github && bash /Users/kevin/Sites/specflow/.claude/skills/test-sandbox/scripts/smoke-backlog-github.sh
  cd /Users/kevin/Sites/specflow
fi
```

Expected (if run): `═══ ALL BACKLOG CHECKS PASSED ═══` — all existing assertions plus the new 13
#264 ones.

**Step 4**: Run the full test suite:

```bash
deno task test
```

Expected: `644 passed | 0 failed`.

**Step 5**: Commit:

```bash
git add .claude/skills/test-sandbox/scripts/smoke-backlog-github.sh
git commit -m "test(backlog): smoke coverage for #264 Roadmap dates + Estimate

Github smoke gains 13 static-grep assertions confirming the three new
axis names (StartDate/TargetDate/Estimate) are documented + dispatched
in set-field.sh, that detect-fields.sh emits the three new *_FIELD_ID
env vars and queries ProjectV2Field nodes, and that the PO agent +
groom phase docs surface the new soft axes and the warn-only report
section.

Static-grep only — the github smoke does not invoke set-field.sh
against a live project. Live invocation is exercised at use time by
the PO agent during grooming.

Refs #264 (AC f).
"
```

---

### Task 6: Branch, push, PR, merge, close issue

**Files:** none — integration task.

**Step 1**: Show the commit history:

```bash
git log --oneline main..HEAD
```

Expected: 5 `feat:` / `test:` commits from Tasks 1–5.

**Step 2**: Branch if not already on one:

```bash
if [ "$(git rev-parse --abbrev-ref HEAD)" = "main" ]; then
  git switch -c 264-roadmap-dates-and-estimate
fi
```

**Step 3**: Push the branch:

```bash
git push --set-upstream origin 264-roadmap-dates-and-estimate
```

**Step 4**: Open the PR via REST:

````bash
cat <<'JSON' > /tmp/pr-264.json
{
  "title": "feat(backlog): Start/Target dates + Estimate for the Roadmap view",
  "head": "264-roadmap-dates-and-estimate",
  "base": "main",
  "body": "Closes #264.\n\n## Agent adoption\n\nGitHub Project #4 ships a Roadmap view that plots items along a timeline using Start date and Target date fields. Those fields were blank for every Specflow item. This PR populates them by extending the existing GitHub backlog-script trio:\n\n- `detect-fields.sh` learns three new fields: StartDate (date), TargetDate (date), Estimate (number).\n- `set-field.sh` learns three new axis names that route to `gh project item-edit --date` or `--number` with the same exit-10 graceful fallback as Priority/Size.\n- The PO agent's classification contract gains the new soft axes — Target date set at Backlog → Ready, Start date set at Ready → In Progress. Both warn-only on missing, never block.\n- The groom phase emits a new ⚠ Roadmap dates missing report section alongside the existing ⚠ size / priority missing escalation.\n\n```prompt\nAfter `specflow upgrade`, the product-owner agent will start setting Target date when it promotes Backlog → Ready and Start date when it moves Ready → In Progress (GitHub backlog only — local Markdown and GitLab have no Roadmap view to feed). Dates use ISO 8601 (YYYY-MM-DD); Estimate is a numeric story-point or day count and stays optional. Missing dates surface as warnings in the groom report — they never block a status move or a classification. To bootstrap an existing project, run `/specflow groom` and the PO will set Target dates on every Ready item and Start dates on every In progress item it touches. To see the populated dates in action, visit your project's Roadmap view on GitHub.\n```\n\n## Files\n\n- `templates/core/skills/backlog/scripts/github/detect-fields.sh` — runtime discovery of `STARTDATE_FIELD_ID`, `TARGETDATE_FIELD_ID`, `ESTIMATE_FIELD_ID` alongside the existing `PRIORITY_*` and `SIZE_*`.\n- `templates/core/skills/backlog/scripts/github/set-field.sh` — new dispatch block for date / number axes; old Priority/Size/IssueType paths untouched.\n- `templates/core/agents/product-owner.md` + plugin twin — classification contract gains 3 soft axes (Target date, Start date, Estimate); usage line for set-field.sh updated.\n- `templates/core/skills/specflow/phases/groom.md` + plugin twin — new step 3a (Roadmap dates), new soft-axes paragraph, new ⚠ Roadmap dates missing report block.\n- `.claude/skills/test-sandbox/scripts/smoke-backlog-github.sh` — 13 new static-grep assertions for the wiring.\n\n## Out of scope (intentionally)\n\n- The org-level issue-sidebar fields (Priority/Effort/Start date/Target date in the issue sidebar) — those duplicate the Project-level fields and are NOT read by the Roadmap view.\n- Auto-computing Target date from Estimate + sprint calendar — scheduling tool territory.\n- Roadmap view configuration, sharing, or export — GitHub already ships the view.\n- The local Markdown backlog backend — no Roadmap view to feed; separate issue if needed.\n- Mandatory enforcement — missing dates must NEVER block a classification or status move.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"
}
JSON
gh api -X POST repos/mkrlabs/specflow/pulls --input /tmp/pr-264.json --jq '{number, state, url: .html_url}'
````

Capture the returned PR number.

**Step 5**: Watch CI:

```bash
PR=$(gh api repos/mkrlabs/specflow/pulls --jq '.[] | select(.head.ref=="264-roadmap-dates-and-estimate") | .number' | head -1)
gh pr checks "$PR" --repo mkrlabs/specflow --watch --interval 15
```

If `docs-drift` fails (likely — the PR touches `templates/core/agents/` and
`templates/core/skills/specflow/phases/`), apply the workaround:

```bash
gh api -X POST "repos/mkrlabs/specflow/issues/$PR/labels" -f "labels[]=docs:not-needed"
```

**Step 6**: Merge once green:

```bash
gh api -X PUT "repos/mkrlabs/specflow/pulls/$PR/merge" -f merge_method=squash
```

**Step 7**: Close #264 via the product-owner subagent — dispatch with `reason: completed`, reference
the merged PR sha in the close comment, list the seven ACs covered.

**Step 8**: Local cleanup:

```bash
git switch main
git pull --ff-only
git branch -D 264-roadmap-dates-and-estimate
```

---

## Verification

End-to-end after all tasks:

1. **Unit suite** — `deno task test` is green at every commit boundary (`644 passed | 0 failed`).
   The PO agent + groom phase changes do not break any unit test directly; the Windsurf cap test
   (`tests/infrastructure/harness/windsurf_harness_test.ts`) and the plugin-sync test
   (`tests/plugin/plugin_sync_test.ts`) are the canaries for over-budget files.
2. **Bundle integrity** — `deno task bundle` succeeds. `src/templates_bundle.ts` reflects the new
   propagator content.
3. **Smoke audit** — `bash .claude/skills/test-sandbox/scripts/audit.sh` →
   `0 coverage gap(s), 0 stale assertion(s)`.
4. **CI cross-smoke** — exercises the github smoke script against a freshly scaffolded project on
   macOS / Ubuntu / Windows; the 13 new assertions must pass on all three.
5. **Pre-commit gates** — every commit hits `deno fmt --check`, `deno lint`, `deno task bundle`,
   `deno check src/main.ts`.
6. **PO agent Windsurf cap** — `wc -c templates/core/agents/product-owner.md` ≤ ~11900 source-chars
   (Windsurf strips ~200, so rendered fits under the 12000 ceiling). Trim contingency documented in
   Task 3 Step 3.

## Out of scope (do NOT do)

- **Wiring up the org-level issue-sidebar fields** (Priority/Effort/Start date/Target date that
  appear in the issue sidebar). Those duplicate the Project-level fields and are NOT read by the
  Roadmap view. Per #264 out-of-scope.
- **Auto-computing Target date from Estimate + sprint calendar.** Scheduling tool territory, not
  backlog tool. Per #264 out-of-scope.
- **Roadmap view configuration, sharing, export.** GitHub ships the view; this issue only populates
  its inputs.
- **The local Markdown backlog backend.** `.specflow/backlog/*.md` frontmatter has no Roadmap to
  feed. Per #264 out-of-scope.
- **Mandatory enforcement of date axes.** Missing dates MUST NEVER block a classification or status
  move — that's an explicit AC (e) of #264.
- **Adding a `--dry-run` flag to `set-field.sh`** for smoke testing. Static-grep is sufficient; live
  invocation is exercised at use time. Adding a dry-run flag is feature creep beyond AC (f).
- **GitLab backend extension.** Scoped labels for dates would need a separate design (no Roadmap
  equivalent on GitLab). Future ticket if relevant.

## PR adoption block

The PR body in Task 6 Step 4 already includes the `## Agent adoption` section per
`.github/pull_request_template.md`. No further work needed at PR time.
