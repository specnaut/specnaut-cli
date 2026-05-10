#!/usr/bin/env bash
# List items on the configured GitHub Project, with Status. Optional filter.
# Usage: list.sh [Status]
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

FILTER="${1:-}"

JSON=$(gh api graphql -f query='
  query($owner:String!, $name:String!) {
    repository(owner:$owner, name:$name) {
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
  }' \
  -f owner="$REPO_OWNER" \
  -f name="$REPO_NAME")

echo "$JSON" | jq -r --argjson project "$PROJECT_NUMBER" --arg filter "$FILTER" '
  .data.repository.issues.nodes[]
  | . as $issue
  | (.projectItems.nodes[] | select(.project.number == $project)) as $item
  | (($item.fieldValues.nodes[]
       | select(.field.name == "Status") | .name) // "—") as $status
  | select($filter == "" or $status == $filter)
  | "  #\(.number)  \($status)  \(.title)"
'
