#!/usr/bin/env bash
# Post a clarification comment on a GitHub issue.
# Usage: clarify-comment.sh <number> "<question>"
#        clarify-comment.sh <number> --body-file <path>
#
# `--body-file` keeps the text off the command line: a caller writes it to a
# file and passes the path, so no quoting stands between the text and gh.
# Exit: 0 posted · 2 usage · 14 a text its secret check refused
# (require_clean_text, _clean_text.sh), nothing sent · other gh's
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"
# shellcheck source=../_backlog_plan.sh
. "$(dirname "$0")/_backlog_plan.sh"

USAGE='usage: clarify-comment.sh <number> "<question>" | <number> --body-file <path>'
if [ "$#" -lt 2 ]; then
  echo "$USAGE" >&2
  exit 2
fi
NUM=$(require_issue_number "$1") || exit 2

if [ "$2" = "--body-file" ]; then
  [ "$#" -eq 3 ] && [ -f "$3" ] || { echo "clarify-comment.sh: --body-file needs a file" >&2; exit 2; }
  require_clean_file body "$3"
  gh issue comment "$NUM" --repo "$REPO" --body-file "$CLEAN_FILE"
else
  require_clean_text body "$2"
  gh issue comment "$NUM" --repo "$REPO" --body "$2"
fi
