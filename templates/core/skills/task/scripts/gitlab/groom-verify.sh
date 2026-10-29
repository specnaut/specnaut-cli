#!/usr/bin/env bash
# Prove a groom run left every issue it processed complete — GitLab backend.
#
# This script FETCHES and NORMALISES; it decides nothing. What "complete" means
# lives in `.specnaut/scripts/bash/groom-rules.sh`, and its header is the rule.
#
# Two `glab` calls per issue: `glab issue view --output json` (as `move.sh`
# reads labels) and the notes API. Where each part of the record comes from:
#   body         the issue description
#   sizes        every `size::<X>` scoped label (`size::M`)
#   priorities   every `priority::<X>` scoped label (`priority::P1`)
#   status       the `Status::<X>` scoped label `move.sh` sets; "" without one
#   comments     the latest 100 notes, system notes excluded — a label change
#                is GitLab's note, not the groom's comment
#   state        `opened` → open, `closed` → closed
#   closed_reason
#                CANNOT be read: GitLab records no reason for closing an issue.
#                Passed as "", so "closed as not_planned" is never an outcome
#                on this backend — the groom's marked comment is.
#
# Usage: groom-verify.sh [--ready <column>|none] <number>...
# Output and exit codes: those of groom-rules.sh — plus exit 2 when an issue
# cannot be fetched. Nothing is reported complete that was not read.
set -euo pipefail

usage() { echo "usage: groom-verify.sh [--ready <column>|none] <number>..." >&2; exit 2; }

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"
RULES="$(dirname "$0")/../bash/groom-rules.sh"

READY="Ready"
ITEMS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --ready) [ -n "${2:-}" ] || usage; READY="$2"; shift 2 ;;
    -h | --help) usage ;;
    '' | *[!0-9]*) echo "groom-verify.sh: not an issue number: '$1'" >&2; usage ;;
    *) ITEMS+=("$1"); shift ;;
  esac
done
[ "${#ITEMS[@]}" -gt 0 ] || usage

# The API path segment: a `group/project` path must be URL-encoded; a numeric
# id passes through unchanged. `-j`, never `-r`: no newline is written, so a
# native Windows jq.exe has none to turn into CRLF — `acme%2Fwidget\r` is no project.
PROJECT_PATH=$(jq -jn --arg p "$PROJECT_ID" '$p | @uri')

# One issue → one record on stdout. Fails (non-zero) when it cannot be read.
record() {
  local issue notes
  issue=$(glab issue view "$1" --repo "$PROJECT_ID" --output json) || return 1
  notes=$(glab api "projects/$PROJECT_PATH/issues/$1/notes?per_page=100&sort=desc&order_by=created_at") ||
    return 1
  # On stdin, not as `--argjson`: a hundred notes can outgrow the argument limit.
  # shellcheck disable=SC2016  # jq program.
  printf '%s\n%s\n' "$issue" "$notes" | jq -n -c -e --arg item "$1" '
    input as $issue | input as $notes
    | def scoped($scope):
      [$issue.labels[]? | select(ascii_downcase | startswith($scope))
       | .[($scope | length):] | gsub("^\"|\"$"; "")];
    if ($notes | type) != "array" then error("notes are not a list") else . end
    | { item: $item,
        body: ($issue.description // ""),
        sizes: scoped("size::"),
        priorities: scoped("priority::"),
        status: (scoped("status::") | first // ""),
        comments: [$notes[] | select(.system != true) | .body // ""],
        state: (if $issue.state == "closed" then "closed"
                elif $issue.state == "opened" then "open"
                else error("state \($issue.state)") end),
        closed_reason: "" }
  '
}

RECORDS=""
for num in "${ITEMS[@]}"; do
  rec=$(record "$num") || { echo "groom-verify.sh: #$num could not be read from $PROJECT_ID — nothing verified" >&2; exit 2; }
  RECORDS+="$rec"$'\n'
done

rc=0
printf '%s' "$RECORDS" | bash "$RULES" --ready "$READY" || rc=$?
exit "$rc"
