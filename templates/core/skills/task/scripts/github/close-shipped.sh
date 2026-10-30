#!/usr/bin/env bash
# After a merge: settle the board for the items the product-owner just closed
# (phases/merge-close.md, spec 042) — the github half. The loop, the lines and
# the exit table are the shared body, _close_shipped.sh, beside this file; what
# is here is how github confirms a close and reconciles the board.
#
# Usage: close-shipped.sh <issue-number>…
set -uo pipefail
here=$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# cascade-check.sh exit 12, and nothing else, means closed. Its stdout (issue
# titles) is not this script's to print; its stderr — why it could not answer —
# passes through.
confirm_closed() {
  local state=0
  bash "$here/cascade-check.sh" "$1" >/dev/null || state=$?
  [ "$state" -eq 12 ] || { echo "cascade-check exit $state"; return 1; }
}

# The whole board once: two sweep passes, then one move-batch.sh Done for every DRIFTED.
reconcile() {
  sweep_board --passes 2 || return 1
  local d
  [ -n "$DRIFTED" ] || return 0
  # shellcheck disable=SC2086 # numbers only, validated by sweep_board
  if bash "$here/move-batch.sh" Done $DRIFTED >/dev/null 2>&1; then
    for d in $DRIFTED; do reconciled "$d"; done
  else
    failed "reconcile — move-batch.sh did not move the drifted cards"
    return 1
  fi
}

# shellcheck source=../_close_shipped.sh
. "$here/_close_shipped.sh"
