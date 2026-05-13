#!/usr/bin/env bash
# List items on the configured GitHub Project, with Status. Optional filter.
#
# Uses `gh issue list --json projectItems` — the gh CLI exposes the Project V2
# Status field via its REST-ish JSON projection, costing ~1 GraphQL point per
# call (vs ~20 for the bulky `repository.issues[].projectItems[].fieldValues[]`
# query that lived here previously and was the main rate-limit offender).
#
# Usage: list.sh [Status]
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

FILTER="${1:-}"

JSON=$(gh issue list --repo "$REPO" --state open --limit 200 \
  --json number,title,projectItems)

echo "$JSON" | jq -r --arg filter "$FILTER" '
  .[]
  | . as $issue
  | (.projectItems[0].status.name // "—") as $status
  | select($issue.projectItems | length > 0)
  | select($filter == "" or $status == $filter)
  | "  #\($issue.number)  \($status)  \($issue.title)"
'
