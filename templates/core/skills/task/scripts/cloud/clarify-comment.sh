#!/usr/bin/env bash
# Post a clarification comment on a task.
# Usage: clarify-comment.sh <number> "<question>"
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 2 ]; then
  echo 'usage: clarify-comment.sh <number> "<question>"' >&2
  exit 2
fi
NUM="$1"
QUESTION="$2"

PAYLOAD=$(jq -n --arg k "$PROJECT_KEY" --argjson n "$NUM" --arg b "$QUESTION" \
  '{ projectKey: $k, number: $n, body: $b }')

RESP=$(curl -fsS -X POST "$API_BASE/comments" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

if echo "$RESP" | jq -e '.ok' >/dev/null 2>&1; then
  echo "✓ commented on #$NUM"
else
  echo "✗ comment failed: $RESP" >&2
  exit 1
fi
