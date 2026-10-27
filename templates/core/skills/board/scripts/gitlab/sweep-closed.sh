#!/usr/bin/env bash
# List backlog items whose Status:: label disagrees with the issue's real state.
#
# This script REPORTS. It never moves an issue. Detection and correction are
# split on purpose: `/board groom` prints this output read-only, while
# `/specnaut merge` pipes the DRIFTED lines into `move.sh`.
#
# Why reconcile rather than attribute: asking "which issues did my merge close"
# reports success from its own belief about the answer, and every failure in
# that shape is silent. Asking "does the board agree with the repository" makes
# the success criterion the outcome itself.
#
# Output (machine-readable, one per line):
#
#   DRIFTED  <number> <current-status>   closed, but not labelled Status::Done
#   REOPENED <number>                    open, but labelled Status::Done
#   scanned <N>, drifted <M>, reopened <R>
#
# **Read the summary line, not the absence of DRIFTED lines.** `drifted 0` is a
# normal quiet run; `scanned 0` is a failure — the query matched nothing at all,
# which looks identical to a clean board.
#
# Unlike the GitHub backend there is no separate board object here: the
# Status:: scoped label *is* the column, and it lives on the issue. So one
# listing answers both halves, and there is no cross-repository scope to guard
# — a GitLab project is the unit.
#
# Usage: sweep-closed.sh [--since <hours>]     (default 24)
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

SINCE_HOURS=24
while [ "$#" -gt 0 ]; do
  case "$1" in
    --since)
      SINCE_HOURS="${2:-}"
      [ -n "$SINCE_HOURS" ] || { echo 'usage: sweep-closed.sh [--since <hours>]' >&2; exit 2; }
      shift 2
      ;;
    -h | --help)
      echo 'usage: sweep-closed.sh [--since <hours>]   (default 24)' >&2
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done
case "$SINCE_HOURS" in
  '' | *[!0-9]*)
    echo "--since expects a whole number of hours, got '$SINCE_HOURS'" >&2
    exit 2
    ;;
esac

# A failed read is not an empty one.
#
# Every read below used to end `2>/dev/null || echo '[]'` — substituting a
# value nobody read. For the project read that produced a misleading message.
# For the two issue reads it produced a FALSE GREEN: an empty closed-issue list
# means "nothing closed in the window", so the drift set is empty, the summary
# prints `drifted 0`, and this script exits 0 over a board with any amount of
# drift. The `scanned 0` guard cannot see it — the project read succeeded and
# only the second call failed.
#
# Observed: a GraphQL rate limit rendered as "could not read Project #N for
# owner X", three runs in a row. Both facts that sentence named were correct,
# and it sent the reader to check a token that was fine.
#
# The shape is `rc=0; X="$(cmd 2>"$errf")" || rc=$?` — the same one
# `cloud/cascade-check.sh` uses throughout. Deliberately NOT a helper that
# exits: `exit` inside a `$( )` leaves the SUBSHELL, the assignment takes the
# empty output, and the caller carries on — which is this defect wearing a
# tidier coat.
sweep_err="$(mktemp "${TMPDIR:-/tmp}/sweep-closed-err.XXXXXX")"
trap 'rm -f "$sweep_err"' EXIT

# Say what could not be read, quote the tool's own words, and stop. Exit 4 is
# "this run could not see the board", which is not a verdict about it.
read_failed() {
  echo "error: could not read $1 — refusing to report a board state this run never saw" >&2
  sed 's/^/  /' "$sweep_err" >&2
  exit 4
}

SINCE="$(date -u -v-"${SINCE_HOURS}"H '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
  || date -u -d "${SINCE_HOURS} hours ago" '+%Y-%m-%dT%H:%M:%SZ')"

# Every page, not the first: see `glab_issues_all` in `_config.sh`. Overlapping
# pages are exit 4 too — this run did not see one consistent board.
# shellcheck disable=SC2034  # read by glab_issues_all, from _config.sh
GLAB_ERR="$sweep_err"
read_all() {
  local what="$1" rc=0
  shift
  glab_issues_all "$@" || rc=$?
  [ "$rc" -ne 2 ] || {
    echo "error: the pages of $what overlapped — refusing to report a board state this run never saw" >&2
    exit 4
  }
  [ "$rc" -eq 0 ] || read_failed "$what"
}

read_all "recently closed issues in $PROJECT_ID" --closed
CLOSED="$GLAB_ISSUES"
read_all "open issues in $PROJECT_ID"
OPEN="$GLAB_ISSUES"

SCANNED="$(jq -n --argjson c "$CLOSED" --argjson o "$OPEN" '($c | length) + ($o | length)')"

status_of='([.labels[]? | select(startswith("Status::"))][0] // "(unset)") | sub("^Status::"; "")'

DRIFTED="$(jq -c -r --arg since "$SINCE" "
  [ .[] | select((.closed_at // \"\") >= \$since)
        | { number: .iid, status: ($status_of) }
        | select(.status != \"Done\") ]" <<<"$CLOSED")"
REOPENED="$(jq -c -r "[ .[] | { number: .iid, status: ($status_of) } | select(.status == \"Done\") ]" <<<"$OPEN")"

echo "$DRIFTED" | jq -r '.[] | "DRIFTED  \(.number) \(.status)"'
echo "$REOPENED" | jq -r '.[] | "REOPENED \(.number)"'
echo "scanned $SCANNED, drifted $(echo "$DRIFTED" | jq 'length'), reopened $(echo "$REOPENED" | jq 'length')"

if [ "$SCANNED" -eq 0 ]; then
  echo "error: scanned 0 issues on $PROJECT_ID — the query matched nothing, which is not the same as a clean board" >&2
  exit 1
fi
