#!/usr/bin/env bash
# Append a clarification block to a backlog item file.
# Usage: clarify-comment.sh <number> "<question>"
#        clarify-comment.sh <number> --body-file <path>
#
# `--body-file` keeps the text off the caller's command line: the file is read
# here and appended as it is.
# Exit: 0 added · 1 no such item · 2 usage · 14 a text its secret check refused
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
NUM=$(printf "%03d" "$NUM")
QUESTION=$BODY
if [ -n "$BODY_FILE" ]; then
  require_clean_file body "$BODY_FILE"
  QUESTION=$(cat -- "$CLEAN_FILE")
else
  require_clean_text body "$QUESTION"
fi

shopt -s nullglob
matches=("$BACKLOG_DIR/$NUM-"*.md)
if [ "${#matches[@]}" -eq 0 ]; then
  echo "no backlog item #$NUM" >&2
  exit 1
fi
FILE="${matches[0]}"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

printf '\n## Clarification (%s)\n\n%s\n' "$NOW" "$QUESTION" >> "$FILE"

echo "✓ added clarification on #$NUM"
