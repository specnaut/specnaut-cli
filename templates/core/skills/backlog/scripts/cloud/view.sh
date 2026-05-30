#!/usr/bin/env bash
# Show one Specflow Cloud task (status, priority, size, body).
# Usage: view.sh <number>
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <number>" >&2
  exit 2
fi
NUM="$1"
AUTH=(-H "Authorization: Bearer $API_TOKEN")

COLS=$(curl -fsS "$API_BASE/columns?projectKey=$PROJECT_KEY" "${AUTH[@]}")
RESP=$(curl -fsS "$API_BASE/tasks?projectKey=$PROJECT_KEY&number=$NUM" "${AUTH[@]}")

echo "$RESP" | jq -r --argjson cols "$COLS" '
  ($cols.columns | map({ (.id): .name }) | add) as $names
  | .task
  | "#\(.number)  \(.title)",
    "status:   \($names[.columnId] // "—")",
    "priority: \(.priority // "—")    size: \(.size // "—")",
    "",
    (.body // "(no description)")
'
