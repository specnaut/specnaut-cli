#!/usr/bin/env bash
# List items on Project #4 with their Status, going through the issue side
# (gh project item-list can return 0 in some account/permission contexts —
# we work around it by querying via repository.issues[].projectItems[]).
# Usage: list.sh [STATUS]
#   STATUS — optional filter: Backlog | Ready | "In progress" | "In review" | Done
set -euo pipefail

FILTER="${1:-}"

JSON=$(gh api graphql -f query='
  query {
    repository(owner:"mkrlabs", name:"specflow") {
      issues(first:100, states:OPEN) {
        nodes {
          number title
          projectItems(first:5) {
            nodes {
              project { number }
              fieldValues(first:8) {
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
    }
  }')

ROWS=$(echo "$JSON" | jq -r '
  .data.repository.issues.nodes[]
  | . as $issue
  | (.projectItems.nodes[] | select(.project.number == 4)) as $item
  | (
      ($item.fieldValues.nodes[]
        | select(.field?.name == "Status")
        | .name) // "—"
    ) as $status
  | "[\($status)]\t#\($issue.number)\t\($issue.title)"
')

if [[ -n "$FILTER" ]]; then
  echo "$ROWS" | grep "^\[$FILTER\]" || true
else
  echo "$ROWS"
fi | sort | column -ts $'\t'
