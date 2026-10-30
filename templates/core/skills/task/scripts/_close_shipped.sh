# shellcheck shell=bash
# The one body of close-shipped.sh (phases/merge-close.md, spec 042, cli#711).
# Sourced — never run — by the backend's own close-shipped.sh, which sets
# `here` (its directory: this file and its siblings sit there) and defines:
#
#   confirm_closed <n>  0 when the issue is confirmed closed; else prints the
#                       reason on stdout and fails. Where the move IS the
#                       close (local, cloud), it always succeeds.
#   reconcile           the board-wide pass after the moves, through
#                       sweep_board / reconciled / failed below; 0 when it
#                       settled, non-zero when it did not. `:` where there is
#                       no board to reconcile against.
#
# Per issue, in the order given: confirm it closed — an open issue's card is
# left alone, because the close comes first and a Done card over an open issue
# is the drift the sweep exists to report — then move it to Done. Then
# reconcile once. One line per item on stdout (DONE, OPEN, FAILED, RECONCILED),
# REOPENED lines and the sweep's own summary line verbatim.
#
# Exit — the full table; phases/merge-close.md maps each one:
#   0  every item settled
#   2  usage: no argument, or one that is not an issue number
#   20 an issue was not confirmed closed (its card left alone; the others
#      still settled) — over 21 when both happened
#   21 a card move or the reconcile failed — reported; the merge has already
#      happened
#
# Usage: close-shipped.sh <issue-number>…

reconciled() { echo "RECONCILED #$1"; }
failed() { echo "FAILED $*"; }

# sweep_board <sweep-closed.sh argument>… — runs the sweep, prints its
# REOPENED lines, and sets DRIFTED (numbers only) and SWEEP_SUMMARY (its last
# line, printed after the moves). A sweep that fails prints its last line and
# a FAILED line, and fails.
DRIFTED=""
SWEEP_SUMMARY=""
sweep_board() {
  local sweep
  if ! sweep=$(bash "$here/sweep-closed.sh" "$@" 2>&1); then
    printf '%s\n' "$sweep" | tail -1
    failed "reconcile — the sweep did not complete"
    return 1
  fi
  DRIFTED=$(printf '%s\n' "$sweep" | awk '$1 == "DRIFTED" { print $2 }' | grep -E '^[0-9]+$' || true)
  printf '%s\n' "$sweep" | grep '^REOPENED' || true
  SWEEP_SUMMARY=$(printf '%s\n' "$sweep" | tail -1)
}

[ $# -gt 0 ] || { echo "usage: close-shipped.sh <issue-number>…" >&2; exit 2; }
for n in "$@"; do
  [[ $n =~ ^[1-9][0-9]{0,9}$ ]] || { echo "close-shipped: '$n' is not an issue number" >&2; exit 2; }
done

rc=0
for n in "$@"; do
  if ! why=$(confirm_closed "$n"); then
    echo "OPEN #$n — not confirmed closed ($why); card left alone"
    rc=20
    continue
  fi
  if bash "$here/move.sh" "$n" Done >/dev/null 2>&1; then
    echo "DONE #$n"
  else
    failed "#$n — the card did not move to Done"
    [ "$rc" -ne 0 ] || rc=21
  fi
done

if ! reconcile; then
  [ "$rc" -ne 0 ] || rc=21
fi
[ -z "$SWEEP_SUMMARY" ] || printf '%s\n' "$SWEEP_SUMMARY"
exit "$rc"
