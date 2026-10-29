#!/usr/bin/env bash
# Post-move hook with two propagation rules:
#
#   - #260: when a sub-issue moves to In Progress or In Review,
#     auto-advance its parent Epic to In Progress (only if the Epic is
#     currently in Backlog or Ready). Manual In Review / Done states
#     are preserved. A child moving to **Ready** does NOT trigger
#     promotion — Ready means "groomed and waiting", not "active work";
#     the parent stays put until a child actually starts. This matches
#     #260 AC(a) which enumerates only "In Progress, In Review, or
#     Done" as the promoting transitions — the prior `*)` glob
#     accidentally also matched Ready.
#
#   - #263: when the LAST open direct child of an Epic reaches Done,
#     auto-advance the parent Epic (only if it is currently in Ready,
#     In Progress, or In Review). Idempotent; manual Backlog parents are
#     left alone. The target is `In review` while the parent ISSUE is
#     still open and `Done` once it is closed — see the promotion block
#     for why. This shipped as an unconditional Done, which wrote a
#     verdict nobody had established and which `sweep-closed.sh` reports
#     as REOPENED drift.
#
# Both rules respect AC(d): DIRECT children only — the recursion guard
# `SPECNAUT_INTERNAL_PROPAGATION=1` blocks the grandparent walk.
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
# parent, SPECNAUT_INTERNAL_PROPAGATION=1 is exported. On re-entry
# the script sees the env var and exits 0 immediately so the
# grandparent is never touched. AC(d) bars multi-level propagation.

set -uo pipefail

CHILD="${1:?usage: propagate-parent-status.sh <child-num> <new-status>}"
NEW_STATUS="${2:?usage: propagate-parent-status.sh <child-num> <new-status>}"

# Recursion guard — see header.
if [ -n "${SPECNAUT_INTERNAL_PROPAGATION:-}" ]; then
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
# Deliberately NOT guarded by `require_project`, unlike the four
# project-writing scripts. This hook's contract is that it always exits 0 —
# propagation must never block the primary child move — so it cannot adopt a
# check that exits 2. The failure still surfaces loudly: the actual write is
# delegated to `move.sh`, which is guarded. What this line swallows is only the
# node-id lookup, and an empty value degrades rather than lying.
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
#           Status AND the parent's own issue state, confirm every child
#           is at Done, advance the parent from Ready/In progress/In
#           review to `In review` (issue open) or `Done` (issue closed).
#           AC(b) idempotency and AC(c) regression guard fall out of the
#           parent-status case (Backlog → no-op), plus a same-target
#           check so no promotion line is printed for a move that did
#           not happen.
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
            state
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
      --jq "{total: .data.repository.issue.subIssues.totalCount, state: .data.repository.issue.state, statuses: [.data.repository.issue.subIssues.nodes[] | .projectItems.nodes[] | select(.project.id == \"$PROJECT_NODE_ID\") | .fieldValueByName.name // empty]}" \
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

    # Which column the evidence supports.
    #
    # `Done` on this board means the work is finished. "Every child is Done" is
    # not that: the parent may carry residual work of its own, and nothing here
    # has verified it — `cascade-check.sh` exists to gate that judgement and
    # this hook deliberately does not consult it. Promoting an OPEN parent to
    # Done wrote a verdict nobody established, and it wrote one the board's own
    # detector reports as a defect: `sweep-closed.sh` names `REOPENED` as
    # "open, but sitting in Done". The hook manufactured, on purpose, the state
    # the sweep exists to flag.
    #
    # The window was structural, not a race — the promotion fires at the
    # CHILD's move, which necessarily precedes any close of the parent, and
    # nothing obliges a caller to close it at all. `phases/merge-close.md`
    # closes the epic itself under the cascade gate and never calls this hook,
    # so the only path this decided anything on was the one where nobody closes
    # the parent.
    #
    # `In review` is the column that means "everything below is finished,
    # awaiting this item's own closure" — exactly what the evidence supports.
    # A parent already CLOSED is the hook's other case and keeps Done: there
    # the card is merely lagging a fact already established.
    PARENT_ISSUE_STATE=""
    if [ -n "$CHILDREN_STATUSES" ]; then
      PARENT_ISSUE_STATE=$(echo "$CHILDREN_STATUSES" | jq -r '.state // empty' 2>/dev/null || echo "")
    fi
    if [ "$PARENT_ISSUE_STATE" = "CLOSED" ]; then
      _target="Done"
      _why="all direct children Done, and the issue is closed"
    else
      _target="In review"
      _why="all direct children Done — the issue is still open, so this is not Done"
    fi

    if [ "$all_done" = "true" ]; then
      case "$PARENT_STATUS" in
        "Ready"|"In progress"|"In review")
          if [ "$PARENT_STATUS" = "$_target" ]; then
            # Already there. Re-writing it would emit a promotion line for a
            # transition that did not happen.
            :
          elif [ -x "$SCRIPT_DIR/move.sh" ]; then
            if SPECNAUT_INTERNAL_PROPAGATION=1 "$SCRIPT_DIR/move.sh" "$PARENT_NUM" "$_target" >/dev/null 2>&1; then
              echo "↑ promoted parent #${PARENT_NUM} (${PARENT_STATUS} → ${_target}) — ${_why}"
            else
              echo "::warning::propagate-parent-status: move.sh failed to advance #${PARENT_NUM} to ${_target}" >&2
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
  "In progress"|"In review")
    # #260 AC(a) (tightened): child moved into In progress or In review
    # — promote a stalled parent. Done is handled by its own arm above
    # (all-children-Done rollup). Moves to Ready are explicitly NOT
    # promoting — see header. Moves into Backlog were already filtered
    # at the top of this script.
    case "$PARENT_STATUS" in
      "Backlog"|"Ready")
        if [ -x "$SCRIPT_DIR/move.sh" ]; then
          # Use the sibling move.sh so the Status field mutation stays
          # consistent with every other move. The recursion guard env var
          # prevents this re-entry from walking further up (AC(d)).
          if SPECNAUT_INTERNAL_PROPAGATION=1 "$SCRIPT_DIR/move.sh" "$PARENT_NUM" "In progress" >/dev/null 2>&1; then
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
  *)
    # Ready (or any unknown / future status) — explicit no-op. Ready
    # means the child is groomed and waiting for a developer to pick
    # it up; that's not active work and should not promote the parent.
    ;;
esac

exit 0
