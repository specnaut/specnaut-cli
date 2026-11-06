#!/usr/bin/env bash
# Apply the product owner's write plan to the local Markdown backlog — the
# bundled executor. The checks, the operations, the output lines and the exit
# table are the shared body, `_apply_plan.sh`, beside this file; the plan's
# vocabulary is `_backlog_plan.sh`. This file supplies only what the task files
# answer differently: no labels, no issue type, date or estimate, and a close
# that is the move to Done. Its RECEIPT names the files it changed, for the
# caller to stage.
#
# Usage: apply-plan.sh <verb> [--id <n>] <plan-file> <items-file>
set -euo pipefail
here=$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=./_config.sh
. "$here/_config.sh"

PLAN_CANNOT='["label", "create:labels", "classify:IssueType", "classify:StartDate", "classify:TargetDate",
  "classify:Estimate"]'
CLOSE_IS_MOVE=1

# The columns move.sh accepts.
board_statuses() { printf '%s\n' Backlog Ready "In progress" "In review" Done; }
repo_labels() { :; }

# add.sh prints `✓ created #NNN — <title>`.
create_item() {
  local args=("$1") out rc=0
  [ -z "$4" ] || args+=(--parent "$4")
  [ -z "$2" ] || args+=(--body-file "$2")
  out=$(bash "$here/add.sh" "${args[@]}" 2>/dev/null) || rc=$?
  printf '%s\n' "$out" | sed -n 's/.*created #0*\([1-9][0-9]*\) .*/\1/p' | head -1
  return "$rc"
}

close_item() { bash "$here/close.sh" "$1" "$2"; }
fallback_label() { :; }

# The index and every task file, as `cksum` sees them: what changed is staged.
receipt_snapshot() {
  (cd "$ROOT" && for f in .specnaut/backlog.md .specnaut/backlog/*.md; do
    [ ! -f "$f" ] || cksum "$f"
  done)
}

# shellcheck source=../_apply_plan.sh
. "$here/_apply_plan.sh"
