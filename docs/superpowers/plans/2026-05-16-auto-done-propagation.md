# Auto-Done propagation for Epic children Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the `propagate-parent-status.sh` hooks shipped in #262 so that when the **last open
direct child** of an Epic transitions to Done, the parent Epic auto-advances to Done (from Ready /
In progress / In review). Symmetric to the #260 Backlog→In progress promotion already in main.

**Architecture:** Surgical addition to the two existing propagator scripts (local + github), keeping
the recursion guard pattern (`SPECFLOW_INTERNAL_PROPAGATION=1`) and the never-block-the-primary-move
failure contract from #260 intact. The "all children Done" check is one extra read per Done
transition: a glob over `.specflow/backlog/*.md` filtered by `parent: "#NNN"` frontmatter (local),
or a single GraphQL query against `Issue.subIssues.nodes.projectItems.fieldValueByName("Status")`
(github). No new files, no schema changes — the propagator gains one decision branch.

**Tech Stack:** Bash 4+ · `awk` / `sed` frontmatter parsing for local · `gh api graphql` for github
· existing `propagate-parent-status.sh` infrastructure from #262.

> Issue: https://github.com/mkrlabs/specflow/issues/263

---

## Spec coverage map

| AC                                                                                                             | Where it lands                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) Last open direct child → Done ⇒ parent moves Ready/In progress/In review → Done                            | Task 1 (local) + Task 2 (github) — new `case "$NEW_STATUS" in "Done")` branch                                                                                                                                                                                                                                          |
| (b) Idempotent — already-Done parent stays Done                                                                | Falls out of the existing `*) no-op` case in the parent-status `case` block. Smoke asserts in Task 3.                                                                                                                                                                                                                  |
| (c) Regression guard — Epic moved back from Done isn't pulled forward again unless children freshly reach Done | Falls out of the design: the propagator only fires on a child→Done transition; no history needed. The `case "$PARENT_STATUS"` block excludes `Backlog` and `Done`, so a parent manually demoted to `In review` after a reopen only re-promotes if and only if a child re-transitions to Done. Smoke asserts in Task 3. |
| (d) DIRECT children only — no nested-Epic walks                                                                | The recursion guard `SPECFLOW_INTERNAL_PROPAGATION=1` already in #262 blocks the grandparent walk; no changes needed.                                                                                                                                                                                                  |
| (e) Dual-backend: github + local                                                                               | Task 1 (local) + Task 2 (github)                                                                                                                                                                                                                                                                                       |
| (f) Propagation failure NEVER blocks the primary move                                                          | Existing `set -uo pipefail` + `exit 0` discipline preserved; every new `gh` / `awk` call is guarded with `                                                                                                                                                                                                             |

Out of scope (do NOT touch): closing the parent issue, cross-repo parent/child, nested-Epic walks
beyond one level, GitLab backend.

---

## File Structure

| File                                                                      | Responsibility                                                                                                                                                                                                      | Action     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `templates/core/skills/backlog/scripts/local/propagate-parent-status.sh`  | Add Done-branch logic that globs `.specflow/backlog/*.md` for direct children, checks all-Done, promotes parent.                                                                                                    | **Modify** |
| `templates/core/skills/backlog/scripts/github/propagate-parent-status.sh` | Add Done-branch logic that queries `Issue.subIssues.nodes.projectItems.fieldValueByName("Status")` via GraphQL, checks all-Done, promotes parent.                                                                   | **Modify** |
| `.claude/skills/test-sandbox/scripts/smoke-backlog-local.sh`              | Existing `#260` block has a single-child case that becomes a #263 Done-propagation trigger; need to add a second sibling child to keep the regression-guard semantic intact, then add new #263-specific assertions. | **Modify** |
| `.claude/skills/test-sandbox/scripts/smoke-backlog-github.sh`             | Static-grep assertions for the new Done-branch logic in the github propagator.                                                                                                                                      | **Modify** |

No new files. No manifest changes (the existing manifest entries already cover both propagator
scripts).

---

## Tasks

### Task 1: Local propagator — add Done branch

**Files:**

- Modify: `templates/core/skills/backlog/scripts/local/propagate-parent-status.sh`

- [ ] **Step 1: Re-read the current local propagator** to confirm the recursion guard,
      early-exit-on-Backlog, parent-resolution, and parent-status-read blocks are exactly as
      documented below.

The current structure (verified against main `99266d6`):

```bash
set -uo pipefail
CHILD="${1:?...}"; NEW_STATUS="${2:?...}"

# Recursion guard
if [ -n "${SPECFLOW_INTERNAL_PROPAGATION:-}" ]; then exit 0; fi

# Moves INTO Backlog don't promote a parent. Bail early.
if [ "$NEW_STATUS" = "Backlog" ]; then exit 0; fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
BACKLOG_DIR="$ROOT/.specflow/backlog"
# (backlog-dir-missing warn + child-file lookup + parent extraction + parent-file lookup)

# Read parent's current status
PARENT_STATUS=$(awk '...' "$PARENT_FILE")

# Only promote if parent is in Backlog or Ready.
case "$PARENT_STATUS" in
  "Backlog"|"Ready")
    if [ -x "$SCRIPT_DIR/move.sh" ]; then
      if SPECFLOW_INTERNAL_PROPAGATION=1 "$SCRIPT_DIR/move.sh" "$PARENT_PADDED" "In progress" ...
      ...
    fi
    ;;
  *)
    # Already at In progress / In review / Done / unknown — no-op.
    ;;
esac

exit 0
```

- [ ] **Step 2: Replace the `case "$PARENT_STATUS"` block** at the bottom of
      `templates/core/skills/backlog/scripts/local/propagate-parent-status.sh` with a
      `NEW_STATUS`-dispatched logic that keeps the existing Backlog/Ready→In progress branch AND
      adds the new Done branch.

Replace:

```bash
# Only promote if parent is in Backlog or Ready.
case "$PARENT_STATUS" in
  "Backlog"|"Ready")
    if [ -x "$SCRIPT_DIR/move.sh" ]; then
      # Use the sibling move.sh so the frontmatter rewrite + index
      # refresh stay consistent with every other status move. The
      # recursion guard env var prevents this re-entry from walking
      # any further up (AC(d): one-level only).
      if SPECFLOW_INTERNAL_PROPAGATION=1 "$SCRIPT_DIR/move.sh" "$PARENT_PADDED" "In progress" >/dev/null 2>&1; then
        echo "↑ promoted parent #${PARENT_PADDED} (${PARENT_STATUS} → In progress) due to child #${CHILD_PADDED} move"
      else
        echo "::warning::propagate-parent-status: move.sh failed to promote #${PARENT_PADDED}" >&2
      fi
    else
      echo "::warning::propagate-parent-status: $SCRIPT_DIR/move.sh not found — cannot promote #${PARENT_PADDED}" >&2
    fi
    ;;
  *)
    # Already at In progress / In review / Done / unknown — no-op.
    # Idempotency + regression guard branch.
    ;;
esac

exit 0
```

With:

```bash
# Dispatch on the child's new status:
#   - Done: AC(a) of #263 — if the parent's other DIRECT children are
#           all Done, advance the parent from Ready/In progress/In review
#           to Done. Idempotent (parent already Done is a no-op via the
#           default case below).
#   - any other non-Backlog status: existing #260 behaviour — promote a
#           Backlog/Ready parent to In progress.
case "$NEW_STATUS" in
  "Done")
    # Are all DIRECT children of $PARENT_NUM at status Done?
    # Glob every backlog file, filter by `parent: "#<padded>"`
    # frontmatter, and check the status. The just-moved child file
    # itself is included — move.sh has already rewritten its status
    # to Done at the point we run, so a single-child Epic completes
    # naturally in one pass.
    all_done=true
    for sibling in "$BACKLOG_DIR"/*.md; do
      [ -f "$sibling" ] || continue
      sibling_parent=$(awk '/^---$/{n++; next} n==1 && /^parent:/{print; exit}' "$sibling" \
        | sed -nE 's/^parent:[[:space:]]*"?#0*([0-9]+)"?[[:space:]]*$/\1/p')
      [ "$sibling_parent" = "$PARENT_NUM" ] || continue
      sibling_status=$(awk '/^---$/{n++; next} n==1 && /^status:/{sub(/^status:[[:space:]]*/, ""); print; exit}' "$sibling")
      if [ "$sibling_status" != "Done" ]; then
        all_done=false
        break
      fi
    done

    if [ "$all_done" = "true" ]; then
      case "$PARENT_STATUS" in
        "Ready"|"In progress"|"In review")
          if [ -x "$SCRIPT_DIR/move.sh" ]; then
            if SPECFLOW_INTERNAL_PROPAGATION=1 "$SCRIPT_DIR/move.sh" "$PARENT_PADDED" "Done" >/dev/null 2>&1; then
              echo "↑ promoted parent #${PARENT_PADDED} (${PARENT_STATUS} → Done) — all direct children Done"
            else
              echo "::warning::propagate-parent-status: move.sh failed to advance #${PARENT_PADDED} to Done" >&2
            fi
          else
            echo "::warning::propagate-parent-status: $SCRIPT_DIR/move.sh not found — cannot advance #${PARENT_PADDED}" >&2
          fi
          ;;
        *)
          # Parent at Backlog (weird but harmless) / Done (idempotent) /
          # unknown — no-op. AC(b) + AC(c).
          ;;
      esac
    fi
    ;;
  *)
    # Existing #260 behaviour: child moved out of Backlog into Ready /
    # In progress / In review — promote a stalled parent.
    case "$PARENT_STATUS" in
      "Backlog"|"Ready")
        if [ -x "$SCRIPT_DIR/move.sh" ]; then
          # Use the sibling move.sh so the frontmatter rewrite + index
          # refresh stay consistent with every other status move. The
          # recursion guard env var prevents this re-entry from walking
          # any further up (AC(d): one-level only).
          if SPECFLOW_INTERNAL_PROPAGATION=1 "$SCRIPT_DIR/move.sh" "$PARENT_PADDED" "In progress" >/dev/null 2>&1; then
            echo "↑ promoted parent #${PARENT_PADDED} (${PARENT_STATUS} → In progress) due to child #${CHILD_PADDED} move"
          else
            echo "::warning::propagate-parent-status: move.sh failed to promote #${PARENT_PADDED}" >&2
          fi
        else
          echo "::warning::propagate-parent-status: $SCRIPT_DIR/move.sh not found — cannot promote #${PARENT_PADDED}" >&2
        fi
        ;;
      *)
        # Already at In progress / In review / Done / unknown — no-op.
        # Idempotency + regression guard branch.
        ;;
    esac
    ;;
esac

exit 0
```

Note on the sibling-parent comparison: the inner `awk | sed` extraction strips both the `#` prefix
and any leading zeros, so the value compared against `$PARENT_NUM` is a bare integer on both sides.

- [ ] **Step 3: Update the file header docstring** to advertise the Done branch.

Replace:

```bash
# Post-move hook: when a sub-task moves OUT of Backlog, auto-advance
# its parent Epic to In Progress — but only if the Epic is currently
# in Backlog or Ready. Manual In Review / Done states are preserved.
```

With:

```bash
# Post-move hook with two propagation rules:
#
#   - #260: when a sub-task moves OUT of Backlog, auto-advance its
#     parent Epic to In Progress (only if the Epic is currently in
#     Backlog or Ready). Manual In Review / Done states are preserved.
#
#   - #263: when the LAST open direct child of an Epic reaches Done,
#     auto-advance the parent Epic to Done (only if it is currently
#     in Ready, In Progress, or In Review). Idempotent on already-Done
#     parents; manual Backlog parents are left alone.
#
# Both rules respect AC(d): DIRECT children only — the recursion guard
# `SPECFLOW_INTERNAL_PROPAGATION=1` blocks the grandparent walk.
```

- [ ] **Step 4: Re-format if needed**

```bash
deno fmt --check templates/core/skills/backlog/scripts/local/propagate-parent-status.sh
```

Expected: silent pass. If the formatter complains, run
`deno fmt templates/core/skills/backlog/scripts/local/propagate-parent-status.sh` to fix.

- [ ] **Step 5: Run the bundle to embed the change in `src/templates_bundle.ts`**

```bash
deno task bundle
```

Expected: `Bundled 86 core entries + 11 harness-specific → src/templates_bundle.ts`.

- [ ] **Step 6: Run the full test suite to confirm no regressions yet**

```bash
deno task test
```

Expected: `644 passed | 0 failed`. The unit tests don't exercise the propagator directly (it's pure
shell, covered by smoke), so this should be green pre-smoke.

- [ ] **Step 7: Commit**

```bash
git add templates/core/skills/backlog/scripts/local/propagate-parent-status.sh src/templates_bundle.ts
git commit -m "feat(backlog): local propagator advances parent Epic to Done when all direct children Done

Adds a NEW_STATUS=Done branch to the local propagate-parent-status.sh hook.
When the just-moved child reaches Done, the script globs the backlog
directory for siblings with the same parent frontmatter, confirms every
sibling is at Done, and promotes the parent from Ready/In progress/In
review to Done via a recursion-guarded move.sh re-entry.

Existing #260 Backlog→In progress propagation is preserved unchanged
in the *) catch-all of the new case dispatch. AC(b) idempotency and
AC(c) regression guard fall out of the parent-status case block — a
parent already at Done or Backlog is left alone.

Refs #263 (AC a, b, c, d local-half).
"
```

---

### Task 2: GitHub propagator — add Done branch

**Files:**

- Modify: `templates/core/skills/backlog/scripts/github/propagate-parent-status.sh`

- [ ] **Step 1: Re-read the current github propagator** to confirm the recursion guard,
      early-exit-on-Backlog, parent-resolution (`Issue.parent { number }`), and parent-status-read
      (`projectItems(first:5).fieldValueByName("Status")`) blocks are exactly as documented in the
      file.

- [ ] **Step 2: Replace the `case "$PARENT_STATUS"` block** at the bottom of
      `templates/core/skills/backlog/scripts/github/propagate-parent-status.sh` with the same
      NEW_STATUS-dispatched shape, using GraphQL to fetch the children's project Status values in
      one round-trip.

Replace:

```bash
# 4. Promote only if parent is in Backlog or Ready.
case "$PARENT_STATUS" in
  "Backlog"|"Ready")
    if [ -x "$SCRIPT_DIR/move.sh" ]; then
      # Use the sibling move.sh so the Status field mutation stays
      # consistent with every other move. The recursion guard env var
      # prevents this re-entry from walking further up (AC(d)).
      if SPECFLOW_INTERNAL_PROPAGATION=1 "$SCRIPT_DIR/move.sh" "$PARENT_NUM" "In progress" >/dev/null 2>&1; then
        echo "↑ promoted parent #${PARENT_NUM} (${PARENT_STATUS} → In progress) due to child #${CHILD} move"
      else
        echo "::warning::propagate-parent-status: move.sh failed to promote #${PARENT_NUM}" >&2
      fi
    else
      echo "::warning::propagate-parent-status: $SCRIPT_DIR/move.sh not found — cannot promote #${PARENT_NUM}" >&2
    fi
    ;;
  *)
    # Already at In progress / In review / Done — no-op.
    # Idempotency + regression guard branch.
    ;;
esac

exit 0
```

With:

```bash
# 4. Dispatch on the child's new status:
#   - Done: AC(a) of #263 — fetch the parent's subIssues with project
#           Status, confirm every child is at Done, advance the parent
#           from Ready/In progress/In review to Done. AC(b) idempotency
#           and AC(c) regression guard fall out of the parent-status
#           case (Done / Backlog → no-op).
#   - any other non-Backlog status: #260 behaviour preserved — promote
#           a Backlog/Ready parent to In progress.
case "$NEW_STATUS" in
  "Done")
    # One GraphQL query: every direct sub-issue's project Status on
    # this project. If the query fails or returns nothing, treat the
    # all-Done answer as "no" and skip silently — propagation must
    # NEVER block the primary child move (AC f).
    CHILDREN_STATUSES=$(gh api graphql -f query='
      query($owner: String!, $name: String!, $num: Int!) {
        repository(owner: $owner, name: $name) {
          issue(number: $num) {
            subIssues(first: 50) {
              nodes {
                number
                projectItems(first: 5) {
                  nodes {
                    project { id }
                    fieldValueByName(name: "Status") {
                      ... on ProjectV2ItemFieldSingleSelectValue { name }
                    }
                  }
                }
              }
            }
          }
        }
      }
    ' -f owner="$REPO_OWNER" -f name="$REPO_NAME" -F num="$PARENT_NUM" \
      --jq "[.data.repository.issue.subIssues.nodes[] | .projectItems.nodes[] | select(.project.id == \"$PROJECT_NODE_ID\") | .fieldValueByName.name // empty]" \
      2>/dev/null) || CHILDREN_STATUSES=""

    all_done=false
    if [ -n "$CHILDREN_STATUSES" ] && [ "$CHILDREN_STATUSES" != "[]" ]; then
      # The jq array contains one entry per direct sub-issue that has a
      # Status set on the project. If every entry is "Done", we promote.
      NON_DONE=$(echo "$CHILDREN_STATUSES" | jq '[.[] | select(. != "Done")] | length' 2>/dev/null || echo 1)
      if [ "$NON_DONE" = "0" ]; then
        all_done=true
      fi
    fi

    if [ "$all_done" = "true" ]; then
      case "$PARENT_STATUS" in
        "Ready"|"In progress"|"In review")
          if [ -x "$SCRIPT_DIR/move.sh" ]; then
            if SPECFLOW_INTERNAL_PROPAGATION=1 "$SCRIPT_DIR/move.sh" "$PARENT_NUM" "Done" >/dev/null 2>&1; then
              echo "↑ promoted parent #${PARENT_NUM} (${PARENT_STATUS} → Done) — all direct children Done"
            else
              echo "::warning::propagate-parent-status: move.sh failed to advance #${PARENT_NUM} to Done" >&2
            fi
          else
            echo "::warning::propagate-parent-status: $SCRIPT_DIR/move.sh not found — cannot advance #${PARENT_NUM}" >&2
          fi
          ;;
        *)
          # Parent at Done (idempotent) / Backlog (left alone) / unknown
          # — no-op. AC(b) + AC(c).
          ;;
      esac
    fi
    ;;
  *)
    # Existing #260 behaviour: child moved out of Backlog into Ready /
    # In progress / In review — promote a stalled parent.
    case "$PARENT_STATUS" in
      "Backlog"|"Ready")
        if [ -x "$SCRIPT_DIR/move.sh" ]; then
          # Use the sibling move.sh so the Status field mutation stays
          # consistent with every other move. The recursion guard env var
          # prevents this re-entry from walking further up (AC(d)).
          if SPECFLOW_INTERNAL_PROPAGATION=1 "$SCRIPT_DIR/move.sh" "$PARENT_NUM" "In progress" >/dev/null 2>&1; then
            echo "↑ promoted parent #${PARENT_NUM} (${PARENT_STATUS} → In progress) due to child #${CHILD} move"
          else
            echo "::warning::propagate-parent-status: move.sh failed to promote #${PARENT_NUM}" >&2
          fi
        else
          echo "::warning::propagate-parent-status: $SCRIPT_DIR/move.sh not found — cannot promote #${PARENT_NUM}" >&2
        fi
        ;;
      *)
        # Already at In progress / In review / Done — no-op.
        # Idempotency + regression guard branch.
        ;;
    esac
    ;;
esac

exit 0
```

- [ ] **Step 3: Update the file header docstring** to advertise the Done branch.

Replace:

```bash
# Post-move hook: when a sub-issue moves OUT of Backlog on the Project
# board, auto-advance its parent Epic to In Progress — but only if the
# Epic is currently in Backlog or Ready. Manual In Review / Done states
# are preserved.
```

With:

```bash
# Post-move hook with two propagation rules:
#
#   - #260: when a sub-issue moves OUT of Backlog, auto-advance its
#     parent Epic to In Progress (only if the Epic is currently in
#     Backlog or Ready). Manual In Review / Done states are preserved.
#
#   - #263: when the LAST open direct child of an Epic reaches Done,
#     auto-advance the parent Epic to Done (only if it is currently
#     in Ready, In Progress, or In Review). Idempotent on already-Done
#     parents; manual Backlog parents are left alone.
#
# Both rules respect AC(d): DIRECT children only — the recursion guard
# `SPECFLOW_INTERNAL_PROPAGATION=1` blocks the grandparent walk.
```

- [ ] **Step 4: Re-format if needed**

```bash
deno fmt --check templates/core/skills/backlog/scripts/github/propagate-parent-status.sh
```

Expected: silent pass.

- [ ] **Step 5: Run the bundle**

```bash
deno task bundle
```

Expected: `Bundled 86 core entries + 11 harness-specific → src/templates_bundle.ts`.

- [ ] **Step 6: Run the full test suite**

```bash
deno task test
```

Expected: `644 passed | 0 failed`.

- [ ] **Step 7: Commit**

```bash
git add templates/core/skills/backlog/scripts/github/propagate-parent-status.sh src/templates_bundle.ts
git commit -m "feat(backlog): github propagator advances parent Epic to Done when all direct children Done

Adds a NEW_STATUS=Done branch to the github propagate-parent-status.sh
hook. When the just-moved sub-issue reaches Done, the script issues
one GraphQL query against Issue.subIssues.nodes.projectItems
.fieldValueByName(\"Status\"), filters for this project, and checks
whether every direct sub-issue's board Status is Done. If so, advances
the parent from Ready/In progress/In review to Done via a recursion-
guarded move.sh re-entry.

Existing #260 Backlog→In progress propagation is preserved unchanged
in the *) catch-all of the new case dispatch. AC(b) idempotency and
AC(c) regression guard fall out of the parent-status case block.

Refs #263 (AC a, b, c, d github-half).
"
```

---

### Task 3: Smoke coverage — local + github

**Files:**

- Modify: `.claude/skills/test-sandbox/scripts/smoke-backlog-local.sh`
- Modify: `.claude/skills/test-sandbox/scripts/smoke-backlog-github.sh`

The existing local smoke at lines 128–153 of `smoke-backlog-local.sh` covers #260's promotion path
but assumes `#001` has only one child `#003`. With #263 in main, moving `#3` to Done becomes the
all-children-Done trigger — so the existing assertion "parent in 'In review' is NOT pulled back to
'In progress' on child move" needs a second sibling child to stay meaningful, AND new assertions
need to exercise the Done-propagation path.

The github smoke at lines 128–138 is static greps only — extend the same way.

- [ ] **Step 1: Add a second sibling child in the local smoke setup**

Before line 137 (`bash .specflow/scripts/backlog/move.sh 1 Backlog >/dev/null`), insert:

```bash
# #263 setup: create a second sibling child of #001 so the original
# #260 single-child assertions below stay meaningful (otherwise child
# #003 → Done would itself complete the set and trigger #263's
# all-children-Done promotion).
bash .specflow/scripts/backlog/add.sh "Second sibling of 1" "" --parent 1 >/dev/null
[ -f .specflow/backlog/004-second-sibling-of-1.md ] \
  && pass "second sibling child #004 created for #263 multi-child smoke" \
  || fail "second sibling #004 not created" "$(ls .specflow/backlog/)"
```

This file uses `pass` / `fail` helpers — confirm both already exist (they do, defined at the top of
the smoke script).

- [ ] **Step 2: Update the existing #260 regression-guard assertion** at line 147–153.

The current block reads:

```bash
# Regression guard: manually advance parent to In review, move another child.
bash .specflow/scripts/backlog/move.sh 1 "In review" >/dev/null
bash .specflow/scripts/backlog/move.sh 3 "Done" >/dev/null
parent_status=$(awk '/^---$/{n++; next} n==1 && /^status:/{sub(/^status:[[:space:]]*/, ""); print; exit}' .specflow/backlog/001-first-item.md)
[ "$parent_status" = "In review" ] \
  && pass "parent in 'In review' is NOT pulled back to 'In progress' on child move" \
  || fail "regression guard broken" "expected 'In review', got '$parent_status'"
```

Replace with:

```bash
# #260 regression guard: parent at 'In review' must stay there when a
# child moves to Done WHILE other open siblings still exist. With #263
# in main, this only holds because we created #004 in Backlog above —
# otherwise child #003 → Done would itself complete the set.
bash .specflow/scripts/backlog/move.sh 1 "In review" >/dev/null
bash .specflow/scripts/backlog/move.sh 3 "Done" >/dev/null
parent_status=$(awk '/^---$/{n++; next} n==1 && /^status:/{sub(/^status:[[:space:]]*/, ""); print; exit}' .specflow/backlog/001-first-item.md)
[ "$parent_status" = "In review" ] \
  && pass "parent in 'In review' stays there while #004 still open (AC c regression guard)" \
  || fail "#260 regression guard broken" "expected 'In review', got '$parent_status'"
```

- [ ] **Step 3: Add the #263 Done-propagation assertions** directly after the block updated in Step
      2 (i.e. before the `echo` + summary block at the end of the file).

Insert:

```bash
echo
echo "═══ #263  Auto-Done propagation when all Epic children Done ═══"
# Static-grep: the Done branch exists in the propagator source.
grep -q '"Done")' .specflow/scripts/backlog/propagate-parent-status.sh \
  && pass "propagate-parent-status.sh has a NEW_STATUS=Done branch (#263)" \
  || fail "Done branch missing in local propagator" "$(grep -n 'case' .specflow/scripts/backlog/propagate-parent-status.sh)"
grep -q 'all_done=true' .specflow/scripts/backlog/propagate-parent-status.sh \
  && pass "propagator computes all_done from sibling frontmatter" \
  || fail "all_done variable missing in local propagator" "$(grep -n 'all_done' .specflow/scripts/backlog/propagate-parent-status.sh)"

# Behaviour: move the remaining open child #004 to Done.
# State before: #001=In review, #003=Done, #004=Backlog.
# Expected after: #001=Done (auto-promoted), #003=Done, #004=Done.
bash .specflow/scripts/backlog/move.sh 4 "Done" >/dev/null
parent_status=$(awk '/^---$/{n++; next} n==1 && /^status:/{sub(/^status:[[:space:]]*/, ""); print; exit}' .specflow/backlog/001-first-item.md)
[ "$parent_status" = "Done" ] \
  && pass "parent auto-advances In review → Done when last open child reaches Done (AC a)" \
  || fail "#263 AC(a) broken" "expected 'Done', got '$parent_status'"

# AC(b) idempotency: moving a Done child to Done again, with parent already Done,
# must NOT corrupt the parent's status (no-op via *) case in PARENT_STATUS).
bash .specflow/scripts/backlog/move.sh 4 "Done" >/dev/null
parent_status=$(awk '/^---$/{n++; next} n==1 && /^status:/{sub(/^status:[[:space:]]*/, ""); print; exit}' .specflow/backlog/001-first-item.md)
[ "$parent_status" = "Done" ] \
  && pass "re-moving a Done child to Done is idempotent on a Done parent (AC b)" \
  || fail "#263 AC(b) idempotency broken" "expected 'Done', got '$parent_status'"

# AC(c) regression guard: manually demote parent back from Done. No child
# transitions to Done after — parent must stay where the user put it.
bash .specflow/scripts/backlog/move.sh 1 "In review" >/dev/null
parent_status=$(awk '/^---$/{n++; next} n==1 && /^status:/{sub(/^status:[[:space:]]*/, ""); print; exit}' .specflow/backlog/001-first-item.md)
[ "$parent_status" = "In review" ] \
  && pass "manually demoting parent from Done back to In review is not auto-reversed (AC c)" \
  || fail "#263 AC(c) — manual demotion not respected" "expected 'In review', got '$parent_status'"

# Parent at Backlog branch — moving a Done child to Done must not promote a
# Backlog parent (AC a explicitly excludes Backlog). Demote parent, re-run.
bash .specflow/scripts/backlog/move.sh 1 "Backlog" >/dev/null
bash .specflow/scripts/backlog/move.sh 4 "Done" >/dev/null
parent_status=$(awk '/^---$/{n++; next} n==1 && /^status:/{sub(/^status:[[:space:]]*/, ""); print; exit}' .specflow/backlog/001-first-item.md)
[ "$parent_status" = "Backlog" ] \
  && pass "Backlog parent is not auto-advanced even when all children Done (AC a exclusion)" \
  || fail "#263 Backlog parent exclusion broken" "expected 'Backlog', got '$parent_status'"
```

- [ ] **Step 4: Extend the github smoke** in
      `.claude/skills/test-sandbox/scripts/smoke-backlog-github.sh`. After the existing `#260` block
      (lines 128–138), append:

```bash
echo
echo "═══ #263  Auto-Done propagation in github propagator (static-grep) ═══"
grep -q '"Done")' .specflow/scripts/backlog/propagate-parent-status.sh \
  && pass "github propagator has a NEW_STATUS=Done branch (#263)" \
  || fail "Done branch missing in github propagator" "$(grep -n 'case' .specflow/scripts/backlog/propagate-parent-status.sh)"
grep -q 'subIssues(first: 50)' .specflow/scripts/backlog/propagate-parent-status.sh \
  && pass "github propagator queries Issue.subIssues for all-Done check" \
  || fail "subIssues query missing in github propagator" "$(grep -n 'subIssues' .specflow/scripts/backlog/propagate-parent-status.sh)"
grep -q 'fieldValueByName(name: "Status")' .specflow/scripts/backlog/propagate-parent-status.sh \
  && pass "github propagator reads each child's Status via fieldValueByName" \
  || fail "Status fieldValueByName missing in github propagator" "$(grep -n 'fieldValueByName' .specflow/scripts/backlog/propagate-parent-status.sh)"
grep -q 'all_done=true' .specflow/scripts/backlog/propagate-parent-status.sh \
  && pass "github propagator computes all_done from project Status array" \
  || fail "all_done variable missing in github propagator" "$(grep -n 'all_done' .specflow/scripts/backlog/propagate-parent-status.sh)"
grep -q '"Ready"|"In progress"|"In review"' .specflow/scripts/backlog/propagate-parent-status.sh \
  && pass "github propagator only auto-advances parents at Ready/In progress/In review (AC a)" \
  || fail "github propagator parent-status guard missing" "$(grep -n 'PARENT_STATUS' .specflow/scripts/backlog/propagate-parent-status.sh)"
```

- [ ] **Step 5: Run the local smoke** (the github one requires live infrastructure, so it's
      static-only at this layer).

```bash
bash .claude/skills/test-sandbox/scripts/smoke-backlog-local.sh
```

Expected: `═══ ALL BACKLOG CHECKS PASSED ═══` with the new assertions included. If a step fails,
read the printed `fail` payload — typically it surfaces the actual frontmatter status that doesn't
match.

- [ ] **Step 6: Run the smoke-coverage audit** to confirm no gap remains.

```bash
bash .claude/skills/test-sandbox/scripts/audit.sh
```

Expected: `0 coverage gap(s), 0 stale assertion(s)`.

- [ ] **Step 7: Run the full test suite**

```bash
deno task test
```

Expected: `644 passed | 0 failed`.

- [ ] **Step 8: Commit**

```bash
git add .claude/skills/test-sandbox/scripts/smoke-backlog-local.sh \
        .claude/skills/test-sandbox/scripts/smoke-backlog-github.sh
git commit -m "test(backlog): smoke coverage for #263 auto-Done propagation

Local smoke gains a second sibling child #004 (so the existing #260
regression-guard assertion stays meaningful — single-child Epic would
otherwise become a Done-propagation trigger under #263). Adds four new
assertions exercising AC(a) auto-Done, AC(b) idempotency, AC(c) manual-
demotion respect, and the AC(a) Backlog-parent exclusion.

Github smoke gains five static-grep assertions confirming the Done
branch, the subIssues GraphQL query, the Status field read, the
all_done computation, and the parent-status guard exist in the
scaffolded propagator.

Refs #263.
"
```

---

### Task 4: Branch, push, PR, merge, close issue

**Files:** none — integration task.

- [ ] **Step 1: Show the commit history**

```bash
git log --oneline main..HEAD
```

Expected: three `feat:` / `test:` commits from Tasks 1–3.

- [ ] **Step 2: Branch if not already on one**

```bash
if [ "$(git rev-parse --abbrev-ref HEAD)" = "main" ]; then
  git switch -c 263-auto-done-propagation
fi
```

- [ ] **Step 3: Push the branch**

```bash
git push --set-upstream origin 263-auto-done-propagation
```

- [ ] **Step 4: Open the PR via REST**

````bash
cat <<'JSON' > /tmp/pr-263.json
{
  "title": "feat(backlog): auto-advance parent Epic to Done when all direct children Done",
  "head": "263-auto-done-propagation",
  "base": "main",
  "body": "Closes #263.\n\n## Agent adoption\n\nComplements #260 — once the last open direct child of an Epic reaches Done, the parent Epic auto-advances from Ready / In progress / In review to Done. Symmetric to the existing Backlog→In progress promotion. No new files, no schema changes; the two propagator scripts shipped in #262 each gain a `case \"$NEW_STATUS\" in \"Done\")` branch.\n\n```prompt\nAfter `specflow upgrade`, your product-owner agent (and any manual `move.sh <child> Done` invocation) will trigger an Epic auto-completion when the just-moved child is the last open direct child of its parent. The Epic moves from Ready / In progress / In review to Done automatically. Idempotent — if the parent is already Done, nothing happens. The Epic's GitHub issue stays OPEN (per #263 out-of-scope) — only the board Status field advances. To opt out for a single move, export SPECFLOW_INTERNAL_PROPAGATION=1 before the move.sh call. To roll back an auto-Done, manually move the Epic back via `move.sh <epic> \"In progress\"` (or any earlier state); the propagator will not re-fire until a child re-transitions to Done.\n```\n\n## Files\n\n- `templates/core/skills/backlog/scripts/local/propagate-parent-status.sh` — NEW_STATUS=Done branch; globs `.specflow/backlog/*.md` filtered by parent frontmatter for the all-Done check.\n- `templates/core/skills/backlog/scripts/github/propagate-parent-status.sh` — NEW_STATUS=Done branch; single GraphQL query against `Issue.subIssues.nodes.projectItems.fieldValueByName(\"Status\")` for the all-Done check.\n- `.claude/skills/test-sandbox/scripts/smoke-backlog-local.sh` — extended setup (second sibling child) + 4 new assertions covering AC(a)/(b)/(c) + Backlog-parent exclusion.\n- `.claude/skills/test-sandbox/scripts/smoke-backlog-github.sh` — 5 static-grep assertions for the Done branch wiring.\n\n## Out of scope (intentionally)\n\n- Closing the Epic ISSUE — only board Status advances. Per #263 scope.\n- Cross-repo parent/child.\n- Nested-Epic walks beyond one direct level — blocked by the existing `SPECFLOW_INTERNAL_PROPAGATION=1` recursion guard.\n- GitLab backend — separate follow-up (same pattern as the #260 gitlab gap).\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"
}
JSON
gh api -X POST repos/mkrlabs/specflow/pulls --input /tmp/pr-263.json --jq '{number, state, url: .html_url}'
````

Capture the returned PR number.

- [ ] **Step 5: Watch CI**

```bash
PR=$(gh api repos/mkrlabs/specflow/pulls --jq '.[] | select(.head.ref=="263-auto-done-propagation") | .number' | head -1)
gh pr checks "$PR" --repo mkrlabs/specflow --watch --interval 15
```

If `docs-check` complains (unlikely — no `templates/core/agents/` or
`templates/core/skills/*/SKILL.md` change), apply the workaround label:

```bash
gh api -X POST "repos/mkrlabs/specflow/issues/$PR/labels" -f "labels[]=docs:not-needed"
```

- [ ] **Step 6: Merge once green**

```bash
gh api -X PUT "repos/mkrlabs/specflow/pulls/$PR/merge" -f merge_method=squash
```

- [ ] **Step 7: Close #263 via the product-owner subagent**

Per CLAUDE.md, every backlog mutation goes through the PO. Dispatch with a concrete instruction:
close #263 with `reason: completed`, reference the merged PR + sha in the close comment, list the
four ACs covered.

- [ ] **Step 8: Local cleanup**

```bash
git switch main
git pull --ff-only
git branch -D 263-auto-done-propagation
```

---

## Verification

End-to-end after all tasks:

1. **Unit suite** — `deno task test` is green at every commit boundary (the propagator is shell, so
   unit tests don't directly exercise it — but bundle integrity + windsurf cap + plugin-sync are all
   gated).
2. **Bundle integrity** — `deno task bundle` succeeds. `src/templates_bundle.ts` reflects the new
   propagator content (both local + github branches).
3. **Local smoke** — `bash .claude/skills/test-sandbox/scripts/smoke-backlog-local.sh` exits 0 with
   all #260 + #263 assertions passing.
4. **Smoke audit** — `bash .claude/skills/test-sandbox/scripts/audit.sh` reports 0 coverage gaps and
   0 stale assertions.
5. **Pre-commit gates** — every commit hits `deno fmt --check`, `deno lint`, `deno task bundle`,
   `deno check src/main.ts`.
6. **CI** — the PR's `cross-smoke` jobs on macOS / Ubuntu / Windows all exercise the local smoke
   against a freshly scaffolded project; the new #263 assertions must pass on all three platforms.

## Out of scope (do NOT do)

- Touching `cascade-check.sh` or `move.sh` — the propagator is the only file with new logic.
- Adding a binary subcommand to inspect propagation state. The propagator is pure shell, invoked by
  `move.sh`'s tail hook. No binary surface.
- Implementing the GitLab backend. Separate follow-up.
- Walking grandparents — explicit AC(d) exclusion. The existing `SPECFLOW_INTERNAL_PROPAGATION=1`
  guard is sufficient.
- Closing the parent ISSUE when all children close — closing remains manual, per #263 out-of-scope.
- Re-deriving the propagator's parent-resolution / parent-status-read blocks — they're battle-tested
  from #262, leave them alone.
- Touching `templates/manifest.json` — no new files.

## PR adoption block

The PR body in Task 4 Step 4 already includes the `## Agent adoption` section per
`.github/pull_request_template.md`. No further work needed at PR time.
