#!/usr/bin/env bash
# Apply the product owner's write plan to GitHub — the bundled executor. The
# checks, the operations, the output lines and the exit table are the shared
# body, `_apply_plan.sh`, beside this file; the plan's vocabulary is
# `_backlog_plan.sh`. This file supplies only what GitHub answers differently.
#
# Usage: apply-plan.sh <verb> [--id <n>] <plan-file> <items-file>
set -euo pipefail
here=$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=./_config.sh
. "$here/_config.sh"

PLAN_CANNOT='[]'
CLOSE_IS_MOVE=0

# The board's Status options, as move.sh resolves them.
board_statuses() {
  gh project field-list "$PROJECT_NUMBER" --owner "$REPO_OWNER" --format json |
    jq_lf -r '.fields[] | select(.name == "Status") | .options[].name'
}

repo_labels() {
  gh label list --repo "$REPO" --limit 1000 --json name --jq '.[].name'
}

# add.sh prints `✓ created: <url>`; the number ends the URL.
create_item() {
  local args=("$1" "" "$3") out rc=0
  [ -z "$4" ] || args+=(--parent "$4")
  [ -z "$2" ] || args+=(--body-file "$2")
  out=$(bash "$here/add.sh" "${args[@]}" 2>/dev/null) || rc=$?
  printf '%s\n' "$out" | sed -n 's|.*created: https://[^ ]*/issues/\([0-9][0-9]*\)$|\1|p' | head -1
  return "$rc"
}

close_item() { bash "$here/close.sh" "$1" "$2"; }

# set-field.sh's exit 10: no such field or type here, so the label carries it.
fallback_label() {
  case $1 in
    Priority) echo "priority:$2" ;;
    Size) echo "size:$2" ;;
    IssueType) printf 'type:%s\n' "$2" | tr '[:upper:]' '[:lower:]' ;;
  esac
}

# Nothing in the repository changes on this backend.
receipt_snapshot() { :; }

# shellcheck source=../_apply_plan.sh
. "$here/_apply_plan.sh"
