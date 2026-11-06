#!/usr/bin/env bash
# Post a clarification comment on a task.
# Usage: clarify-comment.sh <number> "<question>"
#        clarify-comment.sh <number> --body-file <path>
#
# `--body-file` keeps the text off the caller's command line: the file is read
# here and travels in the JSON payload, with no shell between the two.
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 2 ]; then
  echo 'usage: clarify-comment.sh <number> "<question>" | <number> --body-file <path>' >&2
  exit 2
fi
NUM=$(require_issue_number "$1") || exit 2
QUESTION="$2"
if [ "$2" = "--body-file" ]; then
  [ "$#" -eq 3 ] && [ -f "$3" ] || { echo "clarify-comment.sh: --body-file needs a file" >&2; exit 2; }
  QUESTION=$(cat -- "$3")
fi

PAYLOAD=$(jq_lf -n --arg k "$PROJECT_KEY" --argjson n "$NUM" --arg b "$QUESTION" \
  '{ projectKey: $k, number: $n, body: $b }')

RESP=$(cloud_curl -X POST "$API_BASE/comments" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

if echo "$RESP" | jq_lf -e '.ok' >/dev/null 2>&1; then
  echo "✓ commented on #$NUM"
else
  echo "✗ comment failed: $RESP" >&2
  exit 1
fi
