#!/usr/bin/env bash
# Move a backlog issue to a Status column on Project #4.
# Usage: move.sh <ISSUE_NUMBER> <STATUS>
#   STATUS — Backlog | Ready | "In progress" | "In review" | Done
set -euo pipefail

ISSUE="${1:?usage: move.sh <issue-number> <status>}"
STATUS="${2:?usage: move.sh <issue-number> <status>}"

PROJECT_ID="PVT_kwDOBv46cs4BV4Gz"
STATUS_FIELD_ID="PVTSSF_lADOBv46cs4BV4GzzhRQrX8"

case "$STATUS" in
  Backlog)        OPT="f75ad846" ;;
  Ready)          OPT="61e4505c" ;;
  "In progress")  OPT="47fc9ee4" ;;
  "In review")    OPT="df73e18b" ;;
  Done)           OPT="98236657" ;;
  *) echo "unknown status: $STATUS (Backlog|Ready|\"In progress\"|\"In review\"|Done)" >&2; exit 1 ;;
esac

ITEM_ID=$(gh api graphql -f query='
  query($num: Int!) {
    repository(owner:"mkrlabs", name:"specflow") {
      issue(number: $num) {
        projectItems(first: 5) {
          nodes { id project { number } }
        }
      }
    }
  }' -F num="$ISSUE" \
  | jq -r '.data.repository.issue.projectItems.nodes[] | select(.project.number == 4) | .id')

if [[ -z "$ITEM_ID" ]]; then
  echo "issue #$ISSUE is not on Project #4" >&2
  exit 1
fi

gh project item-edit \
  --id "$ITEM_ID" \
  --project-id "$PROJECT_ID" \
  --field-id "$STATUS_FIELD_ID" \
  --single-select-option-id "$OPT" >/dev/null

echo "moved #$ISSUE → $STATUS"
