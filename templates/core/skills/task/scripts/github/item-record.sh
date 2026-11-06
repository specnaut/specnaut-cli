#!/usr/bin/env bash
# One record per issue, as JSON Lines — GitHub backend. The one fetch both
# `groom-verify.sh` (through groom-rules.sh) and `read-items.sh` read.
#
# This script FETCHES and NORMALISES; it decides nothing. One GraphQL
# round-trip per issue (`gh issue view --json projectItems` carries the Status
# of each project item but no other field, so it cannot answer for Priority /
# Size). Where each part of the record comes from:
#   item         the issue number, as a string
#   title, body  the issue's own text
#   created      createdAt, as GitHub gives it
#   author, association, by_viewer
#                the issue author's login, authorAssociation (OWNER, MEMBER,
#                NONE, ...) and viewerDidAuthor: whether the account `gh` is
#                logged in as wrote it. A deleted account's login is null,
#                and its by_viewer false: null for both is the local backend's
#                own text (groom-rules.sh), never a remote comment's.
#   sizes        the `Size` single-select of THIS project's item (project number
#                and owner from backlog-config.yml), plus every `size:<X>` label
#   priorities   the same, `Priority` field + `priority:<X>` labels. Both
#                surfaces are read because a value may live on either (field
#                first, label fallback) — a disagreement is two values.
#   status       the `Status` single-select of this project's item; "" when the
#                issue is not on the project
#   comments     the last 100 comments (the groom's comment is recent), each
#                { body, author, association, by_viewer } as for the issue
#   state, closed_reason
#                the issue's state and stateReason, lower-cased
#                (`not_planned`, `completed`, …)
# Field names match case-insensitively, as `detect-fields.sh` does. A projected
# organization field is read as the project item lists it; if the item does not
# carry the value, the axis reads as missing — never as present.
#
# Usage: item-record.sh <number>...
# Output: one JSON object per line, in the order given — or nothing at all:
# exit 2 when an argument is not an issue number or an issue cannot be fetched
# (gh error, rate limit, missing scope, unknown issue). Nothing is printed that
# was not read.
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

[ "$#" -gt 0 ] || { echo "usage: item-record.sh <number>..." >&2; exit 2; }
ITEMS=()
for a in "$@"; do
  n=$(require_issue_number "$a") || exit 2
  ITEMS+=("$n")
done
case "$PROJECT_NUMBER" in
  '' | *[!0-9]*) echo "item-record.sh: project_number '$PROJECT_NUMBER' is not a number" >&2; exit 2 ;;
esac

# shellcheck disable=SC2016  # GraphQL variables, not shell ones.
QUERY='
  query($owner: String!, $name: String!, $num: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $num) {
        title body createdAt state stateReason
        author { login } authorAssociation viewerDidAuthor
        labels(first: 100) { nodes { name } }
        comments(last: 100) { nodes { body author { login } authorAssociation viewerDidAuthor } }
        projectItems(first: 20) {
          nodes {
            project { number owner { ... on Organization { login } ... on User { login } } }
            fieldValues(first: 50) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field { ... on ProjectV2SingleSelectField { name } }
                }
              }
            }
          }
        }
      }
    }
  }'

# One issue → one record on stdout. Fails (non-zero) when it cannot be read.
record() {
  local raw
  raw=$(gh api graphql -f query="$QUERY" -f owner="$REPO_OWNER" -f name="$REPO_NAME" -F num="$1") ||
    return 1
  # shellcheck disable=SC2016  # jq program.
  printf '%s' "$raw" | jq_lf -c -e --arg item "$1" --argjson project "$PROJECT_NUMBER" --arg owner "$REPO_OWNER" '
    .data.repository.issue // error("no such issue")
    | ([.projectItems.nodes[]?
        | select(.project.number == $project
                 and ((.project.owner.login // "") | ascii_downcase) == ($owner | ascii_downcase))]
       | first // {}) as $card
    | def field($n):
        [$card.fieldValues.nodes[]? | select(((.field.name // "") | ascii_downcase) == $n) | .name];
      def labelled($prefix):
        [.labels.nodes[]?.name | select(ascii_downcase | startswith($prefix)) | .[($prefix | length):]];
      def who: { author: (.author.login // null), association: (.authorAssociation // null),
                 by_viewer: (if .author.login == null then false
                             else .viewerDidAuthor | if type == "boolean" then . else null end end) };
    { item: $item,
      title: (.title // ""),
      created: (.createdAt // null),
      body: (.body // "") }
    + who
    + { sizes: (field("size") + labelled("size:")),
        priorities: (field("priority") + labelled("priority:")),
        status: (field("status") | first // ""),
        comments: [.comments.nodes[]? | { body: (.body // "") } + who],
        state: (if .state == "CLOSED" then "closed" elif .state == "OPEN" then "open" else error("state \(.state)") end),
        closed_reason: ((.stateReason // "") | ascii_downcase) }
  '
}

RECORDS=""
for num in "${ITEMS[@]}"; do
  rec=$(record "$num") || { echo "item-record.sh: #$num could not be read from $REPO" >&2; exit 2; }
  RECORDS+="$rec"$'\n'
done
printf '%s' "$RECORDS"
