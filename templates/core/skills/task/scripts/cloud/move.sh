#!/usr/bin/env bash
# Move a task to <Status> (a column name, e.g. "In Progress"). The Cloud API
# resolves the column name → columnId server-side.
#
# Usage: move.sh <number> <Status>
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 2 ]; then
  echo 'usage: move.sh <number> <Status>' >&2
  echo '  Status: one of the board'"'"'s own column names, as columns.sh lists them' >&2
  exit 2
fi
NUM=$(require_issue_number "$1") || exit 2
STATUS="$2"

PAYLOAD=$(jq_lf -n --arg k "$PROJECT_KEY" --argjson n "$NUM" --arg s "$STATUS" \
  '{ projectKey: $k, number: $n, status: $s }')

RESP=$(cloud_curl -X PATCH "$API_BASE/tasks" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

if echo "$RESP" | jq_lf -e '.ok' >/dev/null 2>&1; then
  echo "✓ #$NUM → $STATUS"
else
  echo "✗ move failed: $RESP" >&2
  exit 1
fi
