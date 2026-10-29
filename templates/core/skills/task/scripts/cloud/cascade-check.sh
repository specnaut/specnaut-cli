#!/usr/bin/env bash
# Verify that a parent task is safe to close — every sub-task must already sit
# in the board's terminal column. Cloud-backend twin, same exit contract as the
# github script so callers need no per-backend branching.
#
# Usage:   cascade-check.sh <task-number>
# Exit:    0  no open children — safe to close
#          11 at least one child is still open — close blocked
#          12 the parent is already in the terminal column — nothing to gate
#          3  the parent does not exist, or the lookup failed
#          2  usage error
#
# --- Which column means "done" -------------------------------------------
# The hosted board's columns are the project's own: an order and a name, and
# nothing that declares one terminal. So this takes the LAST column by order
# and NAMES IT on every run.
#
# That naming is the whole safety of the convention. A board that grew a
# column after its done column would otherwise silently stop gating, and an
# epic would close over unfinished children with no sign anything was wrong.
# Announced, a wrong target is visible in the first line of output.
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 1 ]; then
  echo 'usage: cascade-check.sh <task-number>' >&2
  exit 2
fi
NUM="$1"
case "$NUM" in
  '' | *[!0-9]*) echo "not a task number: '$NUM'" >&2; exit 2 ;;
esac

AUTH=(-H "Authorization: Bearer $API_TOKEN")

rc=0
COLS=$(curl -fsS "$API_BASE/columns?projectKey=$PROJECT_KEY" "${AUTH[@]}") || rc=$?
if [ "$rc" -ne 0 ] || [ -z "$COLS" ]; then
  echo "✗ could not read the board's columns" >&2
  exit 3
fi

TERMINAL_ID=$(printf '%s' "$COLS" | jq -r '.columns | sort_by(.order) | last | .id // empty')
TERMINAL_NAME=$(printf '%s' "$COLS" | jq -r '.columns | sort_by(.order) | last | .name // empty')
TERMINAL_ORDER=$(printf '%s' "$COLS" | jq -r '.columns | sort_by(.order) | last | .order')
COLUMN_COUNT=$(printf '%s' "$COLS" | jq -r '.columns | length')
if [ -z "$TERMINAL_ID" ]; then
  echo "✗ the board reports no columns — nothing to gate against" >&2
  exit 3
fi
echo "  terminal column: \"$TERMINAL_NAME\" (order $TERMINAL_ORDER of $COLUMN_COUNT)"

rc=0
PARENT=$(curl -fsS "$API_BASE/tasks?projectKey=$PROJECT_KEY&number=$NUM" "${AUTH[@]}") || rc=$?
if [ "$rc" -ne 0 ] || [ -z "$PARENT" ]; then
  echo "✗ task #$NUM not found on the board (or the lookup failed)" >&2
  exit 3
fi

PARENT_COL=$(printf '%s' "$PARENT" | jq -r '.task.columnId // empty')
if [ "$PARENT_COL" = "$TERMINAL_ID" ]; then
  echo "ℹ #$NUM is already in \"$TERMINAL_NAME\" — nothing to gate"
  exit 12
fi

# One request for every child. The contract enumerates by parent number, so
# this never costs one call per child.
rc=0
KIDS=$(curl -fsS "$API_BASE/tasks?projectKey=$PROJECT_KEY&parentNumber=$NUM" "${AUTH[@]}") || rc=$?
if [ "$rc" -ne 0 ] || [ -z "$KIDS" ]; then
  echo "✗ could not enumerate the children of #$NUM" >&2
  exit 3
fi

OPEN_LIST=$(printf '%s' "$KIDS" | jq -r --arg term "$TERMINAL_ID" --argjson cols "$COLS" '
  ($cols.columns | map({ (.id): .name }) | add) as $names
  | .tasks // []
  | map(select(.columnId != $term))
  | .[] | "  - #\(.number) — \(.title) [in \"\($names[.columnId] // "—")\"]"
')
OPEN=$(printf '%s' "$OPEN_LIST" | grep -c '^  - ' || true)
TOTAL=$(printf '%s' "$KIDS" | jq -r '(.tasks // []) | length')

if [ "$OPEN" -gt 0 ]; then
  echo "✗ #$NUM has $OPEN open child task(s) of $TOTAL — close them first"
  printf '%s\n' "$OPEN_LIST"
  exit 11
fi

# "No child is linked at all" and "every child is done" are different facts.
# Both are safe to close, and a caller deciding whether a cascade even applies
# could not tell them apart while they shared one sentence. This backend was
# already correct about the dangerous half — it checks every exit code and
# refuses rather than guessing — so this is the only change it needs.
if [ "$TOTAL" -eq 0 ]; then
  echo "✓ #$NUM has no linked children — no cascade applies"
else
  echo "✓ #$NUM safe to close — all $TOTAL child task(s) are in \"$TERMINAL_NAME\""
fi
exit 0
