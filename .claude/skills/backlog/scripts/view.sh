#!/usr/bin/env bash
# Show one issue's title, body, current Status on Project #4, and any
# comments. Useful when about to clarify an item.
# Usage: view.sh <ISSUE_NUMBER>
set -euo pipefail

ISSUE="${1:?usage: view.sh <issue-number>}"

STATUS=$(gh api graphql -f query='
  query($num: Int!) {
    repository(owner:"mkrlabs", name:"specflow") {
      issue(number: $num) {
        projectItems(first: 5) {
          nodes {
            project { number }
            fieldValues(first: 8) {
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
  }' -F num="$ISSUE" \
  | jq -r '
    [.data.repository.issue.projectItems.nodes[]
      | select(.project.number == 4)
      | .fieldValues.nodes[]
      | select(.field?.name == "Status")
      | .name][0] // "—"
  ')

echo "════ Issue #$ISSUE — Status: $STATUS ════"
gh issue view "$ISSUE" --repo mkrlabs/specflow --comments
