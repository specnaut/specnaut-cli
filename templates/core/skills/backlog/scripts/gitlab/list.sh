#!/usr/bin/env bash
# List open issues on the configured GitLab project, with their Status::
# scoped label. Optional Status filter.
# Usage: list.sh [Status]
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

FILTER="${1:-}"

JSON=$(glab issue list --repo "$PROJECT_ID" --output json --per-page 100 \
  --state opened 2>/dev/null || echo "[]")

echo "$JSON" | jq -r --arg filter "$FILTER" '
  .[]
  | . as $issue
  | (
      [.labels[]? | select(startswith("Status::"))][0] // "—"
    ) as $rawStatus
  | ($rawStatus | sub("^Status::"; "")) as $status
  | select($filter == "" or $status == $filter)
  | "  #\(.iid)  \($status)  \(.title)"
'
