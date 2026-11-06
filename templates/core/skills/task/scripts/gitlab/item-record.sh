#!/usr/bin/env bash
# One record per issue, as JSON Lines — GitLab backend. The one fetch both
# `groom-verify.sh` (through groom-rules.sh) and `read-items.sh` read.
#
# This script FETCHES and NORMALISES; it decides nothing. The signed-in user
# once per run (`glab api user`), then two `glab` calls per issue:
# `glab issue view --output json` (as `move.sh` reads labels) and the notes
# API. Where each part of the record comes from:
#   item         the issue's iid, as a string
#   title, body  the issue's title and description
#   created      created_at, as GitLab gives it
#   author       the author's username
#   association  CANNOT be read: GitLab has no author association. null.
#   by_viewer    whether the author is the user `glab` is signed in as; null
#                when that user could not be read
#   sizes        every `size::<X>` scoped label (`size::M`)
#   priorities   every `priority::<X>` scoped label (`priority::P1`)
#   status       the `Status::<X>` scoped label `move.sh` sets; "" without one
#   comments     the latest 100 notes, system notes excluded — a label change
#                is GitLab's note, not the groom's comment — each
#                { body, author, association, by_viewer } as for the issue
#   state        `opened` → open, `closed` → closed
#   closed_reason
#                CANNOT be read: GitLab records no reason for closing an issue.
#                Passed as "", so "closed as not_planned" is never an outcome
#                on this backend — the groom's marked comment is.
#
# Usage: item-record.sh <number>...
# Output: one JSON object per line, in the order given — or nothing at all:
# exit 2 when an argument is not an issue number or an issue cannot be fetched.
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

[ "$#" -gt 0 ] || { echo "usage: item-record.sh <number>..." >&2; exit 2; }
ITEMS=()
for a in "$@"; do
  n=$(require_issue_number "$a") || exit 2
  ITEMS+=("$n")
done

# The API path segment: a `group/project` path must be URL-encoded; a numeric
# id passes through unchanged. `-j`, never `-r`: no newline is written, so a
# native Windows jq.exe has none to turn into CRLF — `acme%2Fwidget\r` is no project.
PROJECT_PATH=$(jq_lf -jn --arg p "$PROJECT_ID" '$p | @uri')

# The signed-in user's id, or "" — then no author is known to be the viewer.
VIEWER=$(glab api user 2>/dev/null | jq_lf -j '.id | numbers' 2>/dev/null) || VIEWER=""
if [ -z "$VIEWER" ]; then
  echo "item-record.sh: could not read the signed-in GitLab user; by_viewer is unknown" >&2
fi

# One issue → one record on stdout. Fails (non-zero) when it cannot be read.
record() {
  local issue notes
  issue=$(glab issue view "$1" --repo "$PROJECT_ID" --output json) || return 1
  notes=$(glab api "projects/$PROJECT_PATH/issues/$1/notes?per_page=100&sort=desc&order_by=created_at") ||
    return 1
  # On stdin, not as `--argjson`: a hundred notes can outgrow the argument limit.
  # shellcheck disable=SC2016  # jq program.
  printf '%s\n%s\n' "$issue" "$notes" | jq_lf -n -c -e --arg item "$1" --arg viewer "$VIEWER" '
    input as $issue | input as $notes
    | def scoped($scope):
      [$issue.labels[]? | select(ascii_downcase | startswith($scope))
       | .[($scope | length):] | gsub("^\"|\"$"; "")];
      def who: { author: (.author.username // null), association: null,
                 by_viewer: (if $viewer == "" or (.author.id | type) != "number" then null
                             else (.author.id | tostring) == $viewer end) };
    if ($notes | type) != "array" then error("notes are not a list") else . end
    | { item: $item,
        title: ($issue.title // ""),
        created: ($issue.created_at // null),
        body: ($issue.description // "") }
      + ($issue | who)
      + { sizes: scoped("size::"),
          priorities: scoped("priority::"),
          status: (scoped("status::") | first // ""),
          comments: [$notes[] | select(.system != true) | { body: (.body // "") } + who],
          state: (if $issue.state == "closed" then "closed"
                  elif $issue.state == "opened" then "open"
                  else error("state \($issue.state)") end),
          closed_reason: "" }
  '
}

RECORDS=""
for num in "${ITEMS[@]}"; do
  rec=$(record "$num") || { echo "item-record.sh: #$num could not be read from $PROJECT_ID" >&2; exit 2; }
  RECORDS+="$rec"$'\n'
done
printf '%s' "$RECORDS"
