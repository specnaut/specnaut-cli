#!/usr/bin/env bash
# After a merge: settle the board for the shipped items (phases/merge-close.md,
# spec 042) — the local copy. On this backend there is no separate issue to
# close: `move.sh <n> Done` IS the close, in one write, and there is no
# board to reconcile against. Same exit contract as the forge copies.
#
# Exit: 0 every item settled · 2 usage · 21 a move failed.
#
# Usage: close-shipped.sh <issue-number>…
set -uo pipefail
here=${BASH_SOURCE[0]%/*}

[ $# -gt 0 ] || { echo "usage: close-shipped.sh <issue-number>…" >&2; exit 2; }
for n in "$@"; do
  [[ $n =~ ^[1-9][0-9]{0,9}$ ]] || { echo "close-shipped: '$n' is not an issue number" >&2; exit 2; }
done
rc=0
for n in "$@"; do
  if bash "$here/move.sh" "$n" Done >/dev/null 2>&1; then
    echo "DONE #$n"
  else
    echo "FAILED #$n — it did not move to Done"
    rc=21
  fi
done
exit "$rc"
