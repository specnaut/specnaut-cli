#!/usr/bin/env bash
# Post a clarification comment on a task.
# Usage: clarify-comment.sh <number> "<question>"
#        clarify-comment.sh <number> --body-file <path>
#
# `--body-file` keeps the text off the caller's command line: the file is read
# here and travels in the JSON payload, with no shell between the two.
# Exit: 0 posted · 1 the board refused · 2 usage · 14 a text its secret check refused
# (require_clean_text, _clean_text.sh), nothing sent
set -euo pipefail

# shellcheck source=../_backlog_args.sh
. "$(dirname "$0")/_backlog_args.sh"
parse_comment_args "$@"

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"
# shellcheck source=../_backlog_plan.sh
. "$(dirname "$0")/_backlog_plan.sh"

NUM=$(require_issue_number "$NUM_ARG") || exit 2
QUESTION=$BODY
if [ -n "$BODY_FILE" ]; then
  require_clean_file body "$BODY_FILE"
  QUESTION=$(cat -- "$CLEAN_FILE")
else
  require_clean_text body "$QUESTION"
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
