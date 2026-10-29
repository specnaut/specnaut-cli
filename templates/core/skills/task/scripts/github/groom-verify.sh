#!/usr/bin/env bash
# Prove a groom run left every issue it processed complete — GitHub backend.
#
# This script FETCHES and NORMALISES; it decides nothing. What "complete" means
# lives in `.specnaut/scripts/bash/groom-rules.sh`, and its header is the rule.
#
# One GraphQL round-trip per issue (`gh issue view --json projectItems` carries
# the Status of each project item but no other field, so it cannot answer for
# Priority / Size). Where each part of the record comes from:
#   body         the issue body
#   sizes        the `Size` single-select of THIS project's item (project number
#                and owner from backlog-config.yml), plus every `size:<X>` label
#   priorities   the same, `Priority` field + `priority:<X>` labels. Both
#                surfaces are read because a value may live on either (field
#                first, label fallback) — a disagreement is two values.
#   status       the `Status` single-select of this project's item; "" when the
#                issue is not on the project
#   comments     the last 100 comment bodies (the groom's comment is recent)
#   state, closed_reason
#                the issue's state and stateReason, lower-cased
#                (`not_planned`, `completed`, …)
# Field names match case-insensitively, as `detect-fields.sh` does. A projected
# organization field is read as the project item lists it; if the item does not
# carry the value, the axis reads as missing — never as present.
#
# Usage: groom-verify.sh [--ready <column>|none] <number>...
#   --ready  the board's ready column, as `groom-columns.sh` resolved it
#            (READY=…; `none` when PROMOTE=no). Default `Ready`.
# Output and exit codes: those of groom-rules.sh — plus exit 2 when an issue
# cannot be fetched (gh error, rate limit, missing scope, unknown issue).
# Nothing is reported complete that was not read.
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
case "$PROJECT_NUMBER" in
  '' | *[!0-9]*) echo "groom-verify.sh: project_number '$PROJECT_NUMBER' is not a number" >&2; exit 2 ;;
esac

# shellcheck disable=SC2016  # GraphQL variables, not shell ones.
QUERY='
  query($owner: String!, $name: String!, $num: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $num) {
        body state stateReason
        labels(first: 100) { nodes { name } }
        comments(last: 100) { nodes { body } }
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
  printf '%s' "$raw" | jq -c -e --arg item "$1" --argjson project "$PROJECT_NUMBER" --arg owner "$REPO_OWNER" '
    .data.repository.issue // error("no such issue")
    | ([.projectItems.nodes[]?
        | select(.project.number == $project
                 and ((.project.owner.login // "") | ascii_downcase) == ($owner | ascii_downcase))]
       | first // {}) as $card
    | def field($n):
        [$card.fieldValues.nodes[]? | select(((.field.name // "") | ascii_downcase) == $n) | .name];
      def labelled($prefix):
        [.labels.nodes[]?.name | select(ascii_downcase | startswith($prefix)) | .[($prefix | length):]];
    { item: $item,
      body: (.body // ""),
      sizes: (field("size") + labelled("size:")),
      priorities: (field("priority") + labelled("priority:")),
      status: (field("status") | first // ""),
      comments: [.comments.nodes[]?.body // ""],
      state: (if .state == "CLOSED" then "closed" elif .state == "OPEN" then "open" else error("state \(.state)") end),
      closed_reason: ((.stateReason // "") | ascii_downcase) }
  '
}

RECORDS=""
for num in "${ITEMS[@]}"; do
  rec=$(record "$num") || { echo "groom-verify.sh: #$num could not be read from $REPO — nothing verified" >&2; exit 2; }
  RECORDS+="$rec"$'\n'
done

rc=0
printf '%s' "$RECORDS" | bash "$RULES" --ready "$READY" || rc=$?
exit "$rc"
