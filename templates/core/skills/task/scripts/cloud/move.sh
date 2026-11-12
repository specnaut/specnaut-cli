#!/usr/bin/env bash
# Move a task to <Status> (a column name, e.g. "In Progress"). The Cloud API
# resolves the column name → columnId server-side.
#
# Usage: move.sh <number> <Status>
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"
# shellcheck source=./_cloud_send.sh
. "$(dirname "$0")/_cloud_send.sh"

if [ "$#" -lt 2 ]; then
  echo 'usage: move.sh <number> <Status>' >&2
  echo '  Status: one of the board'"'"'s own column names, as columns.sh lists them' >&2
  exit 2
fi
NUM=$(require_issue_number "$1") || exit 2
STATUS="$2"

# The request body is sent from a file (cloud_send), never as an argument.
RESP=$(printf '%s' "$STATUS" |
  jq_lf -c -Rs --arg k "$PROJECT_KEY" --argjson n "$NUM" '{ projectKey: $k, number: $n, status: . }' |
  cloud_send PATCH "$API_BASE/tasks")

if echo "$RESP" | jq_lf -e '.ok' >/dev/null 2>&1; then
  echo "✓ #$NUM → $STATUS"
else
  echo "✗ move failed: $RESP" >&2
  exit 1
fi
