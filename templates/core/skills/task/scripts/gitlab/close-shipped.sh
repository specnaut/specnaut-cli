#!/usr/bin/env bash
# After a merge: settle the board for the items the product-owner just closed
# (phases/merge-close.md, spec 042) — the gitlab half. The loop, the lines and
# the exit table are the shared body, _close_shipped.sh, beside this file; what
# is here is how gitlab confirms a close and reconciles the board.
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

# The whole board once: one sweep pass — this backend's sweep takes no
# --passes, and the items settled here were confirmed closed above — then one
# move.sh Done per DRIFTED.
reconcile() {
  local d ok=0
  sweep_board || return 1
  for d in $DRIFTED; do
    if bash "$here/move.sh" "$d" Done >/dev/null 2>&1; then
      reconciled "$d"
    else
      failed "#$d — the drifted card did not move"
      ok=1
    fi
  done
  return "$ok"
}

# shellcheck source=../_close_shipped.sh
. "$here/_close_shipped.sh"
