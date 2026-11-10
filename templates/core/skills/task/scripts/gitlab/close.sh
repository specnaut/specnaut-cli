#!/usr/bin/env bash
# Close a GitLab issue. GitLab records no reason for a close, so only
# `completed` is accepted: a reason that would not be recorded is refused,
# never dropped. It checks no gate: the executor and `phases/merge-close.md`
# run cascade-check.sh first, and move the card after.
#
# Usage: close.sh <number> [completed] [--body-file <path>]
#   --body-file  a closing note, posted from the file through
#                clarify-comment.sh before the close; a failed post closes nothing
# Exit: 0 closed · 2 usage, or a reason GitLab cannot record · 14 the note
# refused by clarify-comment.sh's secret check, nothing posted or closed ·
# other glab's
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

usage() { echo 'usage: close.sh <number> [completed] [--body-file <path>]' >&2; exit 2; }
[ "$#" -ge 1 ] || usage
NUM=$(require_issue_number "$1") || exit 2
shift
case "${1:-}" in
  completed) shift ;;
  --body-file | '') ;;
  *) echo "close.sh: GitLab records no close reason; only 'completed'" >&2; exit 2 ;;
esac
BODY=""
if [ "${1:-}" = --body-file ]; then
  [ "$#" -eq 2 ] && [ -f "$2" ] || { echo "close.sh: --body-file needs a file" >&2; exit 2; }
  BODY=$2
  shift 2
fi
[ "$#" -eq 0 ] || usage

[ -z "$BODY" ] || bash "$(dirname "$0")/clarify-comment.sh" "$NUM" --body-file "$BODY" >/dev/null
glab issue close "$NUM" --repo "$PROJECT_ID" >/dev/null
echo "closed #$NUM"
