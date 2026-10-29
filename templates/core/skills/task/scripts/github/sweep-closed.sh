#!/usr/bin/env bash
# List backlog items whose board column disagrees with the issue's real state.
#
# This script REPORTS. It never moves a card. Detection and correction are
# split on purpose: `/task groom` prints this output read-only, while
# `/task merge` pipes the DRIFTED lines into `move.sh`. A read-only core
# cannot mutate anything from the wrong caller, and both callers get the same
# answer to "what drifted".
#
# Why reconcile rather than attribute: asking "which issues did my merge close"
# reports success from its own belief about the answer, and every failure in
# that shape is silent. Asking "does the board agree with the repository"
# makes the success criterion the outcome itself.
#
# Output (machine-readable, one per line):
#
#   DRIFTED  <number> <current-status>   closed, but not in Done
#   REOPENED <number>                    open, but sitting in Done
#   scanned <N>, drifted <M>, reopened <R>
#
# **Read the summary line, not the absence of DRIFTED lines.** `drifted 0` is a
# normal quiet run; `scanned 0` is a failure — it means the query matched
# nothing at all, which looks identical to a clean board. That distinction is
# the whole point of the summary existing.
#
# Scope: this repository only, and issues closed within --since hours. The
# board is org-wide, so an unscoped sweep would report cards this repository's
# work never touched.
#
# `--passes 2` re-scans after a short pause and unions the results. GitHub's
# auto-close lands 1–2s after the push, so a sweep run immediately by the merge
# phase can legitimately see an issue that is not closed *yet* — and a single
# pass would report a clean board with total confidence. Grooming needs no
# second pass; a merge does.
#
# Usage: sweep-closed.sh [--since <hours>] [--passes <n>]   (default 24, 1)
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

SINCE_HOURS=24
PASSES=1
while [ "$#" -gt 0 ]; do
  case "$1" in
    --passes)
      PASSES="${2:-}"
      [ -n "$PASSES" ] || { echo 'usage: sweep-closed.sh [--since <hours>] [--passes <n>]' >&2; exit 2; }
      shift 2
      ;;
    --since)
      SINCE_HOURS="${2:-}"
      [ -n "$SINCE_HOURS" ] || { echo 'usage: sweep-closed.sh [--since <hours>]' >&2; exit 2; }
      shift 2
      ;;
    -h | --help)
      echo 'usage: sweep-closed.sh [--since <hours>] [--passes <n>]   (default 24, 1)' >&2
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      echo 'usage: sweep-closed.sh [--since <hours>]' >&2
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
case "$PASSES" in
  '' | *[!0-9]* | 0)
    echo "--passes expects a positive whole number, got '$PASSES'" >&2
    exit 2
    ;;
esac

ALL_DRIFTED='[]'
ALL_REOPENED='[]'
SCANNED=0

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

# A truncated read is not a complete one either. Every list call below caps
# what it returns, and a cap that is reached drops the rest without a word: a
# board larger than `--limit 500` scanned 500 and reported `drifted 0` over the
# items it never saw. So the caps are generous and every read checks it
# got everything — the project read against its own `totalCount`, each issue
# read by refusing a result that fills its cap. The closed read goes through
# search, which GitHub stops at 1000 results whatever the limit says.
READ_LIMIT=5000
SEARCH_LIMIT=1000

# Exit 4, as for a failed read: this run did not see the whole board.
read_truncated() {
  echo "error: $1 — refusing to report a board state this run only partly saw" >&2
  exit 4
}

# <json array> <cap> <what>
check_not_capped() {
  [ "$(echo "$1" | jq 'length')" -lt "$2" ] ||
    read_truncated "the $3 filled the $2 cap and may be cut short"
}

pass=1
while [ "$pass" -le "$PASSES" ]; do
  [ "$pass" -gt 1 ] && sleep 5

  # One project read, then one issue-state read per repo — not per item.
  rc=0
  ITEMS="$(gh project item-list "$PROJECT_NUMBER" --owner "$REPO_OWNER" \
    --format json --limit "$READ_LIMIT" 2>"$sweep_err")" || rc=$?
  [ "$rc" -eq 0 ] || read_failed "Project #$PROJECT_NUMBER for owner $REPO_OWNER"
  if [ -z "$ITEMS" ]; then
    echo "error: Project #$PROJECT_NUMBER for owner $REPO_OWNER returned no output" >&2
    echo "  The call succeeded, so this is the board answering, not a failed read." >&2
    exit 1
  fi
  read_count="$(echo "$ITEMS" | jq '.items | length')"
  total_count="$(echo "$ITEMS" | jq '.totalCount // empty')"
  [ -n "$total_count" ] ||
    read_truncated "Project #$PROJECT_NUMBER returned no totalCount, so this run cannot tell whether it read every item"
  [ "$read_count" -ge "$total_count" ] ||
    read_truncated "read $read_count of the $total_count items on Project #$PROJECT_NUMBER"

  # `.content.repository` — NOT `.repository`. Filtering on the latter silently
  # yields an empty set, which reads as "the board is clean" when it is not.
  SCOPED="$(echo "$ITEMS" | jq -c --arg repo "$REPO" '
    [ .items[]
      | select(.content.type == "Issue")
      | select((.content.repository // "") | endswith($repo))
      | { number: .content.number, status: (.status // "(unset)") } ]')"

  SCANNED="$(echo "$SCOPED" | jq 'length')"

  # Issue state is not exposed by `item-list`, so read it per repo in one call.
  # The `date` fallback keeps its own `2>/dev/null`: BSD and GNU date disagree
  # on the flag, and trying one then the other is the portability shim, not a
  # discarded error.
  rc=0
  CLOSED="$(gh issue list --repo "$REPO" --state closed --limit "$SEARCH_LIMIT" \
    --search "closed:>=$(date -u -v-"${SINCE_HOURS}"H '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
      || date -u -d "${SINCE_HOURS} hours ago" '+%Y-%m-%dT%H:%M:%SZ')" \
    --json number --jq '[.[].number]' 2>"$sweep_err")" || rc=$?
  [ "$rc" -eq 0 ] || read_failed "recently closed issues in $REPO"
  check_not_capped "$CLOSED" "$SEARCH_LIMIT" "recently closed issue list for $REPO"

  rc=0
  OPEN="$(gh issue list --repo "$REPO" --state open --limit "$READ_LIMIT" \
    --json number --jq '[.[].number]' 2>"$sweep_err")" || rc=$?
  [ "$rc" -eq 0 ] || read_failed "open issues in $REPO"
  check_not_capped "$OPEN" "$READ_LIMIT" "open issue list for $REPO"

  D="$(jq -n -c --argjson items "$SCOPED" --argjson closed "$CLOSED" '
    [ $items[] | select(.status != "Done") | select(.number as $n | $closed | index($n)) ]')"
  R="$(jq -n -c --argjson items "$SCOPED" --argjson open "$OPEN" '
    [ $items[] | select(.status == "Done") | select(.number as $n | $open | index($n)) ]')"

  # Union across passes, keyed on number: a later pass can only ever add.
  ALL_DRIFTED="$(jq -n -c --argjson a "$ALL_DRIFTED" --argjson b "$D" \
    '($a + $b) | group_by(.number) | map(.[0])')"
  ALL_REOPENED="$(jq -n -c --argjson a "$ALL_REOPENED" --argjson b "$R" \
    '($a + $b) | group_by(.number) | map(.[0])')"

  pass=$((pass + 1))
done

DRIFTED="$ALL_DRIFTED"
REOPENED="$ALL_REOPENED"

echo "$DRIFTED" | jq -r '.[] | "DRIFTED  \(.number) \(.status)"'
echo "$REOPENED" | jq -r '.[] | "REOPENED \(.number)"'

echo "scanned $SCANNED, drifted $(echo "$DRIFTED" | jq 'length'), reopened $(echo "$REOPENED" | jq 'length')"

# A board with items is the precondition for this script meaning anything. Zero
# is not "nothing drifted" — it is "the query found no items", which happens
# when the project number is wrong or the repo filter matched nothing.
if [ "$SCANNED" -eq 0 ]; then
  echo "error: scanned 0 board items for $REPO — the query matched nothing, which is not the same as a clean board" >&2
  exit 1
fi
