#!/usr/bin/env bash
# Edit a GitHub issue: its title, and text appended to its body. A body is
# never replaced: what is there stays, and the new text follows a blank line.
#
# Usage: edit.sh <number> [--title <title>] [--append-file <path>]
#
# The body travels as a file (`gh issue edit --body-file`), written in a fresh
# directory only the user can open; the title as one argument.
# Exit: 0 edited · 2 usage · 3 the current body could not be read · 14 a text
# its secret check refused (require_clean_text), nothing sent · other gh's
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"
# shellcheck source=../_backlog_plan.sh
. "$(dirname "$0")/_backlog_plan.sh"

USAGE='usage: edit.sh <number> [--title <title>] [--append-file <path>]'
[ "$#" -ge 1 ] || { echo "$USAGE" >&2; exit 2; }
NUM=$(require_issue_number "$1") || exit 2
shift
TITLE="" HAS_TITLE=false APPEND=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --title) [ "$#" -ge 2 ] || { echo "$USAGE" >&2; exit 2; }; TITLE=$2 HAS_TITLE=true; shift 2 ;;
    --append-file) [ "$#" -ge 2 ] && [ -f "$2" ] || { echo "edit.sh: --append-file needs a file" >&2; exit 2; }; APPEND=$2; shift 2 ;;
    *) echo "$USAGE" >&2; exit 2 ;;
  esac
done
[ "$HAS_TITLE" = true ] || [ -n "$APPEND" ] || { echo "$USAGE" >&2; exit 2; }
# The caller's text is judged, never the body it is appended to.
[ "$HAS_TITLE" = false ] || require_clean_text title "$TITLE"
if [ -n "$APPEND" ]; then require_clean_file append "$APPEND"; APPEND=$CLEAN_FILE; fi

ARGS=(issue edit "$NUM" --repo "$REPO")
[ "$HAS_TITLE" = false ] || ARGS+=(--title "$TITLE")
if [ -n "$APPEND" ]; then
  BODY=$(gh issue view "$NUM" --repo "$REPO" --json body --jq '.body') || { echo "edit.sh: could not read #$NUM's body" >&2; exit 3; }
  { [ -z "$BODY" ] || printf '%s\n\n' "$BODY"; cat -- "$APPEND"; } >"$CLEAN_DIR/body.md"
  ARGS+=(--body-file "$CLEAN_DIR/body.md")
fi
gh "${ARGS[@]}" >/dev/null
echo "edited #$NUM"
