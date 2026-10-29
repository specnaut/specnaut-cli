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
  echo '  Status one of: Backlog, Ready, "In Progress", "In Review", Done' >&2
  exit 2
fi
NUM="$1"
STATUS="$2"

PAYLOAD=$(jq -n --arg k "$PROJECT_KEY" --argjson n "$NUM" --arg s "$STATUS" \
  '{ projectKey: $k, number: $n, status: $s }')

RESP=$(curl -fsS -X PATCH "$API_BASE/tasks" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

if echo "$RESP" | jq -e '.ok' >/dev/null 2>&1; then
  echo "✓ #$NUM → $STATUS"
else
  echo "✗ move failed: $RESP" >&2
  exit 1
fi
