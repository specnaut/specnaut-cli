#!/usr/bin/env bash
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
#
# GitHub backend: parent link comes from the native sub-issues GA,
# read via GraphQL Issue.parent { number }. Parent's current Status
# field on the project board is read via the same projectItems(first:5)
# pattern move.sh uses. Promotion delegates back to move.sh.
#
# Usage: propagate-parent-status.sh <child-issue-num> <new-child-status>
#   child-issue-num   : integer issue number on the configured repo
#   new-child-status  : Backlog | Ready | "In progress" | "In review" | Done
#
# Always exits 0. Every failure path emits a stderr warning and
# returns success — propagation must NEVER block the primary child
# move per #260 AC(e).
#
# Recursion guard (AC(d)): when this script triggers move.sh on the
# parent, SPECFLOW_INTERNAL_PROPAGATION=1 is exported. On re-entry
# the script sees the env var and exits 0 immediately so the
# grandparent is never touched. AC(d) bars multi-level propagation.

set -uo pipefail

CHILD="${1:?usage: propagate-parent-status.sh <child-num> <new-status>}"
NEW_STATUS="${2:?usage: propagate-parent-status.sh <child-num> <new-status>}"

# Recursion guard — see header.
if [ -n "${SPECFLOW_INTERNAL_PROPAGATION:-}" ]; then
  exit 0
fi

# Moves INTO Backlog don't promote a parent.
if [ "$NEW_STATUS" = "Backlog" ]; then
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source the shared config — REPO_OWNER, REPO_NAME, PROJECT_NUMBER.
# If the config helper isn't readable or fails, exit 0 silently —
# the primary move already succeeded; we don't want stderr noise on
# fresh projects that haven't filled in backlog-config.yml yet.
# shellcheck source=./_config.sh
if ! . "$SCRIPT_DIR/_config.sh" 2>/dev/null; then
  exit 0
fi

# 1. Resolve parent via GraphQL Issue.parent { number }.
PARENT_NUM=$(gh api graphql -f query='
  query($owner: String!, $name: String!, $num: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $num) { parent { number } }
    }
  }
' -f owner="$REPO_OWNER" -f name="$REPO_NAME" -F num="$CHILD" \
  --jq '.data.repository.issue.parent.number // empty' 2>/dev/null) || PARENT_NUM=""

if [ -z "$PARENT_NUM" ]; then
  # Top-level issue, or transient API error — silent exit.
  exit 0
fi

# 2. Resolve the project node id (lazy lookup, mirrors move.sh).
PROJECT_NODE_ID=$(gh project view "$PROJECT_NUMBER" --owner "$REPO_OWNER" --format json --jq '.id' 2>/dev/null) || PROJECT_NODE_ID=""
if [ -z "$PROJECT_NODE_ID" ]; then
  echo "::warning::propagate-parent-status: cannot resolve project node id — skipping promotion of parent #${PARENT_NUM}" >&2
  exit 0
fi

# 3. Read the parent's current Status field on the project board.
PARENT_STATUS=$(gh api graphql -f query='
  query($owner: String!, $name: String!, $num: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $num) {
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
' -f owner="$REPO_OWNER" -f name="$REPO_NAME" -F num="$PARENT_NUM" \
  --jq ".data.repository.issue.projectItems.nodes[] | select(.project.id == \"$PROJECT_NODE_ID\") | .fieldValueByName.name // empty" 2>/dev/null) || PARENT_STATUS=""

# Parent not on the project, or no Status set yet — nothing to do.
if [ -z "$PARENT_STATUS" ]; then
  exit 0
fi

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
    # this project, plus the total child count. The page-size cap of
    # 100 matches Project V2 GraphQL's hard-cap; an Epic with more than
    # 100 direct children short-circuits to all_done=false (safer to
    # refuse than risk wrong auto-Done). If the query fails entirely,
    # CHILDREN_STATUSES stays empty → all_done=false. Propagation must
    # NEVER block the primary child move (AC f).
    CHILDREN_STATUSES=$(gh api graphql -f query='
      query($owner: String!, $name: String!, $num: Int!) {
        repository(owner: $owner, name: $name) {
          issue(number: $num) {
            subIssues(first: 100) {
              totalCount
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
      --jq "{total: .data.repository.issue.subIssues.totalCount, statuses: [.data.repository.issue.subIssues.nodes[] | .projectItems.nodes[] | select(.project.id == \"$PROJECT_NODE_ID\") | .fieldValueByName.name // empty]}" \
      2>/dev/null) || CHILDREN_STATUSES=""

    all_done=false
    if [ -n "$CHILDREN_STATUSES" ]; then
      # If the parent has > 100 direct children, conservatively skip — we
      # only fetched the first page (Project V2 GraphQL hard-caps at 100
      # per page) and can't safely answer "are they all Done?" without a
      # second round-trip. Refuse to promote rather than risk a wrong
      # auto-Done.
      TOTAL=$(echo "$CHILDREN_STATUSES" | jq '.total // 0' 2>/dev/null || echo 0)
      if [ "$TOTAL" -gt 0 ] && [ "$TOTAL" -le 100 ]; then
        # The statuses array contains one entry per direct sub-issue that
        # has a Status set on this project. If every entry is "Done", we
        # promote.
        NON_DONE=$(echo "$CHILDREN_STATUSES" | jq '[.statuses[] | select(. != "Done")] | length' 2>/dev/null || echo 1)
        if [ "$NON_DONE" = "0" ]; then
          all_done=true
        fi
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
