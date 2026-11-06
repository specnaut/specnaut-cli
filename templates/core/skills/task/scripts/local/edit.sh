#!/usr/bin/env bash
# Edit a backlog item: its frontmatter title, and text appended to its body.
# A body is never replaced: the new text follows what is there.
#
# Usage: edit.sh <number> [--title <title>] [--append-file <path>]
#
# A title passes the plan's title rule (_backlog_plan.sh): one line, so it can
# never add a frontmatter key.
# Exit: 0 edited · 1 no such item · 2 usage or a refused title
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
[ "$HAS_TITLE" = false ] || require_title "$TITLE" || exit 2

FILE=$(item_file "$NUM") || { echo "no backlog item #$NUM" >&2; exit 1; }
[ "$HAS_TITLE" = false ] || fm_set "$FILE" title "$TITLE" || { echo "#$NUM has no frontmatter" >&2; exit 1; }
[ -z "$APPEND" ] || { printf '\n'; cat -- "$APPEND"; printf '\n'; } >>"$FILE"

bash "$(dirname "$0")/render-index.sh" "$ROOT"
echo "edited #$NUM"
