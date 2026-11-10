#!/usr/bin/env bash
# Close a GitHub issue with its reason. It checks no gate: the executor and
# `phases/merge-close.md` run cascade-check.sh first, and move the card after.
#
# Usage: close.sh <number> [completed|not_planned] [--body-file <path>]
#   --body-file  a closing comment, posted from the file through
#                clarify-comment.sh before the close; a failed post closes nothing
# Exit: 0 closed · 2 usage · 14 the comment refused by clarify-comment.sh's
# secret check, nothing posted or closed · other gh's
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

usage() { echo 'usage: close.sh <number> [completed|not_planned] [--body-file <path>]' >&2; exit 2; }
[ "$#" -ge 1 ] || usage
NUM=$(require_issue_number "$1") || exit 2
shift
REASON=completed
case "${1:-}" in completed | not_planned) REASON=$1; shift ;; esac
BODY=""
if [ "${1:-}" = --body-file ]; then
  [ "$#" -eq 2 ] && [ -f "$2" ] || { echo "close.sh: --body-file needs a file" >&2; exit 2; }
  BODY=$2
  shift 2
fi
[ "$#" -eq 0 ] || usage
[ "$REASON" = completed ] || REASON="not planned"

[ -z "$BODY" ] || bash "$(dirname "$0")/clarify-comment.sh" "$NUM" --body-file "$BODY" >/dev/null
gh issue close "$NUM" --repo "$REPO" --reason "$REASON" >/dev/null
echo "closed #$NUM"
