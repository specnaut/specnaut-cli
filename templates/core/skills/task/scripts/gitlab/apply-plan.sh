#!/usr/bin/env bash
# Apply the product owner's write plan to GitLab — the bundled executor. The
# checks, the operations, the output lines and the exit table are the shared
# body, `_apply_plan.sh`, beside this file; the plan's vocabulary is
# `_backlog_plan.sh`. This file supplies only what GitLab answers differently:
# scoped labels for status and classification, and no reason on a close.
#
# Usage: apply-plan.sh <verb> [--id <n>] <plan-file> <items-file>
set -euo pipefail
here=$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=./_config.sh
. "$here/_config.sh"

# GitLab records no reason for closing an issue (item-record.sh).
PLAN_CANNOT='["close:not_planned"]'
CLOSE_IS_MOVE=0

# The columns move.sh accepts.
board_statuses() { printf '%s\n' Backlog Ready "In progress" "In review" Done; }

repo_labels() {
  local enc
  enc=$(jq_lf -rn --arg p "$PROJECT_ID" '$p | @uri')
  glab api --paginate "projects/$enc/labels?per_page=100" | jq_lf -r '.[]?.name // empty'
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

# set-field.sh writes scoped labels itself: it never answers 10.
fallback_label() { :; }
receipt_snapshot() { :; }

# shellcheck source=../_apply_plan.sh
. "$here/_apply_plan.sh"
