#!/usr/bin/env bash
# Post a clarification comment on a GitLab issue.
# Usage: clarify-comment.sh <number> "<question>"
#        clarify-comment.sh <number> --body-file <path>
#
# `--body-file` keeps the text off the caller's command line: the file is read
# here and handed to glab as one argument, with no shell between the two.
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

glab issue note "$NUM" --repo "$PROJECT_ID" --message "$QUESTION"
