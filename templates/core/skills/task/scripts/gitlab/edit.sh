#!/usr/bin/env bash
# Edit a GitLab issue: its title, and text appended to its description. A
# description is never replaced: what is there stays, and the new text
# follows a blank line.
#
# Usage: edit.sh <number> [--title <title>] [--append-file <path>]
#
# Each text travels in the JSON request body glab reads on stdin (glab_send,
# _config.sh), never as an argument.
# Exit: 0 edited · 2 usage · 3 the description could not be read · 14 a text
# its secret check refused (require_clean_text), or a description that holds a
# quick action, which a rewrite would run: nothing sent · other glab's
set -euo pipefail

# shellcheck source=../_backlog_args.sh
. "$(dirname "$0")/_backlog_args.sh"
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
# The caller's text is judged, never the description it is appended to.
[ "$HAS_TITLE" = false ] || require_clean_text title "$TITLE"
if [ -n "$APPEND" ]; then require_clean_file append "$APPEND"; APPEND=$CLEAN_FILE; fi

BODY=""
if [ -n "$APPEND" ]; then
  BODY=$(glab issue view "$NUM" --repo "$PROJECT_ID" --output json | jq_lf -r '.description // ""') ||
    { echo "edit.sh: could not read #$NUM's description" >&2; exit 3; }
  # Rewriting the description would run any quick action it already holds.
  rc=0; quick_action_check "$BODY" >/dev/null || rc=$?
  case $rc in 0) ;; 1) echo "REFUSED quick-action description" >&2; exit 14 ;; *) exit 2 ;; esac
  ADDED=$(cat -- "$APPEND"; printf x)
  if [ -n "$BODY" ]; then BODY="$BODY"$'\n\n'"${ADDED%x}"; else BODY=${ADDED%x}; fi
fi
# A field the caller did not give is left out of the request.
texts_json '. as [$title, $description]
    | (if $t == "true" then {title: $title} else {} end)
    + (if $d == "true" then {description: $description} else {} end)' \
  --arg t "$HAS_TITLE" --arg d "${APPEND:+true}" -- "$TITLE" "$BODY" |
  glab_send PUT "issues/$NUM" >/dev/null
echo "edited #$NUM"
