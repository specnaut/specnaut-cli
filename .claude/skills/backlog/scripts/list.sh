#!/usr/bin/env bash
# List items on Project #4 with their Status. Uses `gh issue list --json
# projectItems` — the gh CLI exposes the Project V2 Status field via its
# REST-ish JSON projection, costing ~1 GraphQL point per call (vs ~20 for
# the hand-rolled `repository.issues[].projectItems[].fieldValues[]` query
# that lived here previously and was the main rate-limit offender).
#
# Usage: list.sh [STATUS]
#   STATUS — optional filter: Backlog | Ready | "In progress" | "In review" | Done
#
# Default (no filter): every issue NOT in Done — matches the historical
# "open issues on the board" semantics. Pass `Done` explicitly to see closed
# items still pinned to the board.
set -euo pipefail

FILTER="${1:-}"

JSON=$(gh issue list --repo mkrlabs/specflow --state open --limit 200 \
  --json number,title,projectItems)

ROWS=$(echo "$JSON" | jq -r --arg filter "$FILTER" '
  .[]
  | . as $issue
  | (.projectItems[0].status.name // "—") as $status
  | select($issue.projectItems | length > 0)
  | select(
      if $filter == "" then $status != "Done"
      else $status == $filter
      end
    )
  | "[\($status)]\t#\($issue.number)\t\($issue.title)"
')

echo "$ROWS" | sort | column -ts $'\t'
