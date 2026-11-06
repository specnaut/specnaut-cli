#!/usr/bin/env bash
# List open issues on the configured GitLab project, with their Status::
# scoped label. Optional Status filter.
# Usage: list.sh [--numbers] [Status]
#   --numbers  one issue number per line and nothing else (`read-items.sh`)
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

NUMBERS=false
if [ "${1:-}" = "--numbers" ]; then NUMBERS=true; shift; fi
FILTER="${1:-}"

JSON=$(glab issue list --repo "$PROJECT_ID" --output json --per-page 100 \
  --state opened 2>/dev/null || echo "[]")

echo "$JSON" | jq_lf -r --arg filter "$FILTER" --argjson numbers "$NUMBERS" '
  .[]
  | . as $issue
  | (
      [.labels[]? | select(startswith("Status::"))][0] // "—"
    ) as $rawStatus
  | ($rawStatus | sub("^Status::"; "")) as $status
  | select($filter == "" or $status == $filter)
  | if $numbers then "\(.iid)" else "  #\(.iid)  \($status)  \(.title)" end
'
