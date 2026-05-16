#!/usr/bin/env bash
# Post-move hook: when a sub-task moves OUT of Backlog, auto-advance
# its parent Epic to In Progress — but only if the Epic is currently
# in Backlog or Ready. Manual In Review / Done states are preserved.
#
# Local backend: parent link lives in `parent: "#NNN"` frontmatter;
# status lives in `status:` frontmatter. Pure shell, no API calls.
#
# Usage: propagate-parent-status.sh <child-num> <new-child-status>
#   child-num         : 3-digit zero-padded local task id (e.g. 042)
#   new-child-status  : Backlog | Ready | "In progress" | "In review" | Done
#
# Always exits 0. Failure to find or update the parent emits a warning
# to stderr but never returns non-zero — propagation must NEVER block
# the primary child move per #260 AC(e).
#
# Recursion guard (AC(d)): the hook walks AT MOST one level up. When
# this script calls back into `move.sh` to promote the parent, it sets
# `SPECFLOW_INTERNAL_PROPAGATION=1`; on re-entry the hook sees the env
# var and exits 0 immediately so the grandparent is never touched.

set -uo pipefail

CHILD="${1:?usage: propagate-parent-status.sh <child-num> <new-status>}"
NEW_STATUS="${2:?usage: propagate-parent-status.sh <child-num> <new-status>}"

# Recursion guard — see header.
if [ -n "${SPECFLOW_INTERNAL_PROPAGATION:-}" ]; then
  exit 0
fi

# Moves INTO Backlog don't promote a parent. Bail early.
if [ "$NEW_STATUS" = "Backlog" ]; then
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Deployed layout: <root>/.specflow/scripts/backlog/<this>.sh — up 3.
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
BACKLOG_DIR="$ROOT/.specflow/backlog"

if [ ! -d "$BACKLOG_DIR" ]; then
  echo "::warning::propagate-parent-status: backlog dir not found at $BACKLOG_DIR — skipping" >&2
  exit 0
fi

# Find the child file (NNN-*.md).
CHILD_PADDED=$(printf '%03d' "$((10#$CHILD))" 2>/dev/null || echo "$CHILD")
shopt -s nullglob
child_matches=("$BACKLOG_DIR/${CHILD_PADDED}-"*.md)
if [ "${#child_matches[@]}" -eq 0 ]; then
  echo "::warning::propagate-parent-status: child #${CHILD_PADDED} not found in $BACKLOG_DIR — skipping" >&2
  exit 0
fi
CHILD_FILE="${child_matches[0]}"

# Extract parent from frontmatter. Convention: `parent: "#NNN"` inside
# the YAML frontmatter (between the first two `---` lines). Missing
# parent or `null` → top-level task, nothing to propagate.
PARENT_LINE=$(awk '/^---$/{n++; next} n==1 && /^parent:/{print; exit}' "$CHILD_FILE")
PARENT_NUM=$(echo "$PARENT_LINE" | sed -nE 's/^parent:[[:space:]]*"?#0*([0-9]+)"?[[:space:]]*$/\1/p')
if [ -z "$PARENT_NUM" ]; then
  exit 0  # top-level task or `parent: null`
fi

PARENT_PADDED=$(printf '%03d' "$((10#$PARENT_NUM))")
parent_matches=("$BACKLOG_DIR/${PARENT_PADDED}-"*.md)
if [ "${#parent_matches[@]}" -eq 0 ]; then
  echo "::warning::propagate-parent-status: parent #${PARENT_PADDED} of child #${CHILD_PADDED} not found — skipping" >&2
  exit 0
fi
PARENT_FILE="${parent_matches[0]}"

# Read parent's current status from frontmatter.
PARENT_STATUS=$(awk '/^---$/{n++; next} n==1 && /^status:/{sub(/^status:[[:space:]]*/, ""); print; exit}' "$PARENT_FILE")

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
