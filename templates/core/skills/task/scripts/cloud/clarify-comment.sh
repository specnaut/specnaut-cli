#!/usr/bin/env bash
# Post a clarification comment on a task.
# Usage: clarify-comment.sh <number> "<question>"
#        clarify-comment.sh <number> --body-file <path>
#
# `--body-file` keeps the text off the caller's command line: the file is read
# here, and the text travels in the JSON request body, sent from a file
# (cloud_send, _cloud_send.sh), never as an argument.
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
# shellcheck source=./_cloud_send.sh
. "$(dirname "$0")/_cloud_send.sh"

NUM=$(require_issue_number "$NUM_ARG") || exit 2
read_body

RESP=$(printf '%s' "$BODY" |
  jq_lf -c -Rs --arg k "$PROJECT_KEY" --argjson n "$NUM" '{ projectKey: $k, number: $n, body: . }' |
  cloud_send POST "$API_BASE/comments")

if echo "$RESP" | jq_lf -e '.ok' >/dev/null 2>&1; then
  echo "✓ commented on #$NUM"
else
  echo "✗ comment failed: $RESP" >&2
  exit 1
fi
