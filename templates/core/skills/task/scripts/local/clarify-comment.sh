#!/usr/bin/env bash
# Append a clarification block to a backlog item file.
# Usage: clarify-comment.sh <number> "<question>"
#        clarify-comment.sh <number> --body-file <path>
#
# `--body-file` keeps the text off the caller's command line: the file is read
# here and appended as it is.
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 2 ]; then
  echo 'usage: clarify-comment.sh <number> "<question>" | <number> --body-file <path>' >&2
  exit 2
fi
NUM=$(require_issue_number "$1") || exit 2
NUM=$(printf "%03d" "$NUM")
QUESTION="$2"
if [ "$2" = "--body-file" ]; then
  [ "$#" -eq 3 ] && [ -f "$3" ] || { echo "clarify-comment.sh: --body-file needs a file" >&2; exit 2; }
  QUESTION=$(cat -- "$3")
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
