#!/usr/bin/env bash
# Post a clarification comment on a GitLab issue.
# Usage: clarify-comment.sh <number> "<question>"
#        clarify-comment.sh <number> --body-file <path>
#
# `--body-file` keeps the text off the caller's command line: the file is read
# here and handed to glab as one argument, with no shell between the two.
# Exit: 0 posted · 2 usage · 14 a text its secret check refused
# (require_clean_text, _clean_text.sh), nothing sent · other glab's
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

glab issue note "$NUM" --repo "$PROJECT_ID" --message "$QUESTION"
