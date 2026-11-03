#!/usr/bin/env bash
# List tasks on the Specnaut Cloud board, with their status (column name).
# Optional Status filter.
#
# Usage: list.sh [Status]
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

FILTER="${1:-}"
COLS=$(cloud_curl "$API_BASE/columns?projectKey=$PROJECT_KEY")
TASKS=$(cloud_curl "$API_BASE/tasks?projectKey=$PROJECT_KEY")

echo "$TASKS" | jq_lf -r --argjson cols "$COLS" --arg filter "$FILTER" '
  ($cols.columns | map({ (.id): .name }) | add) as $names
  | .tasks
  | sort_by(.number)[]
  | ($names[.columnId] // "—") as $status
  | select($filter == "" or $status == $filter)
  | "  #\(.number)  \($status)  \(.title)"
'
