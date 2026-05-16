#!/usr/bin/env bash
# Post-move hook: when a sub-issue moves OUT of Backlog on the Project
# board, auto-advance its parent Epic to In Progress — but only if the
# Epic is currently in Backlog or Ready. Manual In Review / Done states
# are preserved.
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
