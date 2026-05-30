#!/usr/bin/env bash
# Create a task on the Specflow Cloud board.
# Usage: add.sh "<title>" [body]
set -euo pipefail

while [ $# -gt 0 ]; do
  case "$1" in
    -h | --help)
      echo 'usage: add.sh "<title>" [body]'
      exit 0
      ;;
    *) break ;;
  esac
done

if [ "$#" -lt 1 ]; then
  echo 'usage: add.sh "<title>" [body]' >&2
  exit 2
fi
TITLE="$1"
BODY="${2:-}"

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

PAYLOAD=$(jq -n --arg k "$PROJECT_KEY" --arg t "$TITLE" --arg b "$BODY" \
  '{ projectKey: $k, title: $t } + (if $b == "" then {} else { body: $b } end)')

RESP=$(curl -fsS -X POST "$API_BASE/tasks" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

KEY=$(echo "$RESP" | jq -r '.task.key // empty')
if [ -n "$KEY" ]; then
  echo "✓ created: $KEY"
else
  echo "✗ create failed: $RESP" >&2
  exit 1
fi
