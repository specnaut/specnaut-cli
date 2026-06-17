#!/usr/bin/env bash
# Post-move hook with two propagation rules:
#
#   - #260: when a sub-task moves to In Progress or In Review,
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
#     auto-advance the parent Epic to Done (only if it is currently
#     in Ready, In Progress, or In Review). Idempotent on already-Done
#     parents; manual Backlog parents are left alone.
#
# Both rules respect AC(d): DIRECT children only — the recursion guard
# `SPECNAUT_INTERNAL_PROPAGATION=1` blocks the grandparent walk.
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
# `SPECNAUT_INTERNAL_PROPAGATION=1`; on re-entry the hook sees the env
# var and exits 0 immediately so the grandparent is never touched.

set -uo pipefail

CHILD="${1:?usage: propagate-parent-status.sh <child-num> <new-status>}"
NEW_STATUS="${2:?usage: propagate-parent-status.sh <child-num> <new-status>}"

# Recursion guard — see header.
if [ -n "${SPECNAUT_INTERNAL_PROPAGATION:-}" ]; then
  exit 0
fi

# Moves INTO Backlog don't promote a parent. Bail early.
if [ "$NEW_STATUS" = "Backlog" ]; then
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Deployed layout: <root>/.specnaut/scripts/backlog/<this>.sh — up 3.
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
BACKLOG_DIR="$ROOT/.specnaut/backlog"

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
            if SPECNAUT_INTERNAL_PROPAGATION=1 "$SCRIPT_DIR/move.sh" "$PARENT_PADDED" "Done" >/dev/null 2>&1; then
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
  "In progress"|"In review")
    # #260 AC(a) (tightened): child moved into In progress or In review
    # — promote a stalled parent. Done is handled by its own arm above
    # (all-children-Done rollup). Moves to Ready are explicitly NOT
    # promoting — see header. Moves into Backlog were already filtered
    # at the top of this script.
    case "$PARENT_STATUS" in
      "Backlog"|"Ready")
        if [ -x "$SCRIPT_DIR/move.sh" ]; then
          # Use the sibling move.sh so the frontmatter rewrite + index
          # refresh stay consistent with every other status move. The
          # recursion guard env var prevents this re-entry from walking
          # any further up (AC(d): one-level only).
          if SPECNAUT_INTERNAL_PROPAGATION=1 "$SCRIPT_DIR/move.sh" "$PARENT_PADDED" "In progress" >/dev/null 2>&1; then
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
  *)
    # Ready (or any unknown / future status) — explicit no-op. Ready
    # means the child is groomed and waiting for a developer to pick
    # it up; that's not active work and should not promote the parent.
    ;;
esac

exit 0
