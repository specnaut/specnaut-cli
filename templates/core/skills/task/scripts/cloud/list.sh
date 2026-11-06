#!/usr/bin/env bash
# List tasks on the Specnaut Cloud board, with their status (column name).
# Optional Status filter.
#
# Usage: list.sh [--numbers] [Status]
#   --numbers  one task number per line and nothing else (`read-items.sh`)
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

NUMBERS=false
if [ "${1:-}" = "--numbers" ]; then NUMBERS=true; shift; fi
FILTER="${1:-}"
COLS=$(cloud_curl "$API_BASE/columns?projectKey=$PROJECT_KEY")
TASKS=$(cloud_curl "$API_BASE/tasks?projectKey=$PROJECT_KEY")

echo "$TASKS" | jq_lf -r --argjson cols "$COLS" --arg filter "$FILTER" --argjson numbers "$NUMBERS" '
  ($cols.columns | map({ (.id): .name }) | add) as $names
  | .tasks
  | sort_by(.number)[]
  | ($names[.columnId] // "—") as $status
  | select($filter == "" or $status == $filter)
  | if $numbers then "\(.number)" else "  #\(.number)  \($status)  \(.title)" end
'
