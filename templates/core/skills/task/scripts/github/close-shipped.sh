#!/usr/bin/env bash
# After a merge: settle the board for the items the product-owner just closed
# (phases/merge-close.md, spec 042) — the github copy. One copy per backend, one
# exit contract; the installer picks this one, so no caller branches on it.
#
# Per issue, in the order given: confirm the issue is closed (cascade-check.sh
# exit 12, and nothing else, means closed) — an open issue's card is left
# alone, because the close comes first and a Done card over an open issue is
# the drift the sweep exists to report. Then move it to Done. Then reconcile
# the whole board once: sweep-closed.sh --passes 2, and one move-batch.sh Done for every DRIFTED.
# One line per item on stdout, and the sweep's own summary line verbatim.
#
# Exit: 0 every item settled · 2 usage · 20 an issue was still open (its card
# left alone; the others still settled) · 21 a card move or the reconcile
# failed — reported, the merge has already happened.
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
  bash "$here/cascade-check.sh" "$n" >/dev/null 2>&1
  state=$?
  if [ "$state" -ne 12 ]; then
    echo "OPEN #$n — not confirmed closed (cascade-check exit $state); card left alone"
    rc=20
    continue
  fi
  if bash "$here/move.sh" "$n" Done >/dev/null 2>&1; then
    echo "DONE #$n"
  else
    echo "FAILED #$n — the card did not move to Done"
    [ "$rc" -ne 0 ] || rc=21
  fi
done

if ! sweep=$(bash "$here/sweep-closed.sh" --passes 2 2>&1); then
  printf '%s\n' "$sweep" | tail -1
  echo "FAILED reconcile — the sweep did not complete"
  [ "$rc" -ne 0 ] || rc=21
  exit "$rc"
fi
drifted=$(printf '%s\n' "$sweep" | awk '$1 == "DRIFTED" { print $2 }' | grep -E '^[0-9]+$' || true)
printf '%s\n' "$sweep" | grep '^REOPENED' || true
if [ -n "$drifted" ]; then
  # shellcheck disable=SC2086 # numbers only, validated above
  if bash "$here/move-batch.sh" Done $drifted >/dev/null 2>&1; then
    for d in $drifted; do echo "RECONCILED #$d"; done
  else
    echo "FAILED reconcile — move-batch.sh did not move the drifted cards"
    [ "$rc" -ne 0 ] || rc=21
  fi
fi
printf '%s\n' "$sweep" | tail -1
exit "$rc"
