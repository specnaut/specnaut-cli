#!/usr/bin/env bash
# Show one Specnaut Cloud task (status, priority, size, body).
# Usage: view.sh <number>
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <number>" >&2
  exit 2
fi
NUM="$1"
COLS=$(cloud_curl "$API_BASE/columns?projectKey=$PROJECT_KEY")
RESP=$(cloud_curl "$API_BASE/tasks?projectKey=$PROJECT_KEY&number=$NUM")

echo "$RESP" | jq_lf -r --argjson cols "$COLS" '
  ($cols.columns | map({ (.id): .name }) | add) as $names
  | .task
  | "#\(.number)  \(.title)",
    "status:   \($names[.columnId] // "—")",
    "priority: \(.priority // "—")    size: \(.size // "—")",
    "",
    (.body // "(no description)")
'
