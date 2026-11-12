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

# shellcheck source=../_backlog_args.sh
. "$(dirname "$0")/_backlog_args.sh"
parse_comment_args "$@"

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"
# shellcheck source=../_backlog_plan.sh
. "$(dirname "$0")/_backlog_plan.sh"

NUM=$(require_issue_number "$NUM_ARG") || exit 2

if [ -n "$BODY_FILE" ]; then
  require_clean_file body "$BODY_FILE"
  gh issue comment "$NUM" --repo "$REPO" --body-file "$CLEAN_FILE"
else
  require_clean_text body "$BODY"
  gh issue comment "$NUM" --repo "$REPO" --body "$BODY"
fi
