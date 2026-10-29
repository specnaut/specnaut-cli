#!/usr/bin/env bash
# Prove a groom run left every task it processed complete — Specnaut Cloud.
#
# This script FETCHES and NORMALISES; it decides nothing. What "complete" means
# lives in `.specnaut/scripts/bash/groom-rules.sh`, and its header is the rule.
#
# The board's columns once per run, then one `GET /tasks?number=` per task —
# the calls `view.sh` makes. Where each part of the record comes from:
#   body         the task's `body`
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
# Usage: groom-verify.sh [--ready <column>|none] <number>...
# Output and exit codes: those of groom-rules.sh — plus exit 2 when a task
# cannot be fetched (API error, no such task, not authenticated). Nothing is
# reported complete that was not read.
set -euo pipefail

usage() { echo "usage: groom-verify.sh [--ready <column>|none] <number>..." >&2; exit 2; }

READY="Ready"
ITEMS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --ready) [ -n "${2:-}" ] || usage; READY="$2"; shift 2 ;;
    -h | --help) usage ;;
    '' | *[!0-9]*) echo "groom-verify.sh: not a task number: '$1'" >&2; usage ;;
    *) ITEMS+=("$1"); shift ;;
  esac
done
[ "${#ITEMS[@]}" -gt 0 ] || usage

# After the arguments: `_config.sh` resolves a token, which a usage error
# should not cost.
# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"
RULES="$(dirname "$0")/../bash/groom-rules.sh"
AUTH=(-H "Authorization: Bearer $API_TOKEN")

if ! COLS=$(curl -fsS "$API_BASE/columns?projectKey=$PROJECT_KEY" "${AUTH[@]}"); then
  echo "groom-verify.sh: could not read the board's columns — nothing verified" >&2
  exit 2
fi

# One task → one record on stdout. Fails (non-zero) when it cannot be read.
record() {
  local resp
  resp=$(curl -fsS "$API_BASE/tasks?projectKey=$PROJECT_KEY&number=$1" "${AUTH[@]}") || return 1
  # shellcheck disable=SC2016  # jq program.
  printf '%s\n%s\n' "$COLS" "$resp" | jq -n -c -e --arg item "$1" '
    input as $cols | input as $resp
    | ([$cols.columns[]? | { (.id): .name }] | add // {}) as $names
    | ($resp.task // error("no such task")) as $t
    | def one($v): [$v | select(. != null and . != "") | tostring | ascii_upcase];
    { item: $item,
      body: ($t.body // ""),
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
  rec=$(record "$num") || { echo "groom-verify.sh: #$num could not be read from $PROJECT_KEY — nothing verified" >&2; exit 2; }
  RECORDS+="$rec"$'\n'
done

rc=0
printf '%s' "$RECORDS" | bash "$RULES" --ready "$READY" || rc=$?
exit "$rc"
