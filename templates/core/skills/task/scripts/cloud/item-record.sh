#!/usr/bin/env bash
# One record per task, as JSON Lines — Specnaut Cloud. The one fetch both
# `groom-verify.sh` (through groom-rules.sh) and `read-items.sh` read.
#
# This script FETCHES and NORMALISES; it decides nothing. One token and the
# board's columns per run, then one `GET /tasks?number=` per task — the calls
# `view.sh` makes. Where each part of the record comes from:
#   item         the task number, as a string
#   title, body  the task's `title` and `body`
#   created      the task's `createdAt`; null without one
#   author, association, by_viewer
#                CANNOT be read: a task payload names no author. null.
#   sizes        the task's `size`, upper-cased (the API carries `m`, `xl`, …)
#   priorities   the task's `priority`, upper-cased (`p1` → `P1`)
#   status       the name of the task's column (`columnId` → `/columns`)
#   comments     CANNOT be read: the API accepts a comment (`clarify-comment.sh`
#                posts one) but serves none back. Passed as null, so a task the
#                groom left with a clarification reads "comments unreadable" —
#                the only outcome this backend can prove is the ready column.
#   state, closed_reason
#                CANNOT be read: a task carries no closed state or close reason
#                (`Done` is a column). Passed as open / "".
#
# Usage: item-record.sh <number>...
# Output: one JSON object per line, in the order given — or nothing at all:
# exit 2 when an argument is not a task number or a task cannot be fetched
# (API error, no such task, not authenticated).
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

[ "$#" -gt 0 ] || { echo "usage: item-record.sh <number>..." >&2; exit 2; }
ITEMS=()
for a in "$@"; do
  n=$(require_issue_number "$a") || exit 2
  ITEMS+=("$n")
done

if ! COLS=$(cloud_curl "$API_BASE/columns?projectKey=$PROJECT_KEY"); then
  echo "item-record.sh: could not read the board's columns" >&2
  exit 2
fi

# One task → one record on stdout. Fails (non-zero) when it cannot be read.
record() {
  local resp
  resp=$(cloud_curl "$API_BASE/tasks?projectKey=$PROJECT_KEY&number=$1") || return 1
  # shellcheck disable=SC2016  # jq program.
  printf '%s\n%s\n' "$COLS" "$resp" | jq_lf -n -c -e --arg item "$1" '
    input as $cols | input as $resp
    | ([$cols.columns[]? | { (.id): .name }] | add // {}) as $names
    | ($resp.task // error("no such task")) as $t
    | def one($v): [$v | select(. != null and . != "") | tostring | ascii_upcase];
    { item: $item,
      title: ($t.title // ""),
      created: ($t.createdAt // null),
      body: ($t.body // ""),
      author: null,
      association: null,
      by_viewer: null,
      sizes: one($t.size),
      priorities: one($t.priority),
      status: ($names[$t.columnId // ""] // ""),
      comments: null,
      state: "open",
      closed_reason: "" }
  '
}

RECORDS=""
for num in "${ITEMS[@]}"; do
  rec=$(record "$num") || { echo "item-record.sh: #$num could not be read from $PROJECT_KEY" >&2; exit 2; }
  RECORDS+="$rec"$'\n'
done
printf '%s' "$RECORDS"
