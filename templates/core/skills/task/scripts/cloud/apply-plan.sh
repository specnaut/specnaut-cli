#!/usr/bin/env bash
# Apply the product owner's write plan to the Specnaut Cloud board — the
# bundled executor. The checks, the operations, the output lines and the exit
# table are the shared body, `_apply_plan.sh`, beside this file; the plan's
# vocabulary is `_backlog_plan.sh`.
#
# This backend creates (with a parent), comments, moves and closes; the
# versioned contract this half calls names no edit, label, classification,
# link or close reason, so a plan holding one is answered UNSUPPORTED and
# nothing is written. A close is the move to the board's terminal column
# (`terminal_column`, _config.sh), whatever it is called, behind the cascade
# check; a `move` may name every other column, never that one.
#
# Usage: apply-plan.sh <verb> [--id <n>] <plan-file> <items-file>
set -euo pipefail
here=$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=./_config.sh
. "$here/_config.sh"

PLAN_CANNOT='["edit", "label", "classify", "link", "close:not_planned", "create:labels"]'
CLOSE_IS_MOVE=1

board_columns() { cloud_curl "$API_BASE/columns?projectKey=$PROJECT_KEY"; }
board_statuses() {
  local cols
  cols=$(board_columns) && open_columns "$cols"
}
repo_labels() { :; }

# add.sh prints `✓ created: <key>`; the key ends with the task's number.
create_item() {
  local args=("$1") out rc=0
  [ -z "$4" ] || args+=(--parent "$4")
  [ -z "$2" ] || args+=(--body-file "$2")
  out=$(bash "$here/add.sh" "${args[@]}" 2>/dev/null) || rc=$?
  printf '%s\n' "$out" | sed -n 's/.*created: [A-Za-z0-9]*-\([1-9][0-9]*\)$/\1/p' | head -1
  return "$rc"
}

close_item() {
  local cols
  cols=$(board_columns) && terminal_column "$cols" || return 3
  bash "$here/move.sh" "$1" "$TERMINAL_NAME"
}
fallback_label() { :; }
receipt_snapshot() { :; }

# shellcheck source=../_apply_plan.sh
. "$here/_apply_plan.sh"
