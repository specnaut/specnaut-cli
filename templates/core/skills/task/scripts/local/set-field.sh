#!/usr/bin/env bash
# Set a classification on a backlog item: its frontmatter `priority:` or
# `size:`, the keys add.sh writes and item-record.sh reads. A task file has no
# issue type, so IssueType answers 10, as GitHub's set-field.sh does for a
# field the board lacks.
#
# Usage: set-field.sh <number> <Priority|Size|IssueType> <value>
# Exit: 0 set · 10 no such field here · 11 a value outside P0-P3 / XS-XL ·
#       12 no such item · 1 usage
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

[ "$#" -eq 3 ] || { echo 'usage: set-field.sh <number> <Priority|Size|IssueType> <value>' >&2; exit 1; }
NUM=$(require_issue_number "$1") || exit 1
case "$2:$3" in
  Priority:P[0-3]) KEY=priority ;;
  Size:XS | Size:S | Size:M | Size:L | Size:XL) KEY=size ;;
  IssueType:*) echo "a task file has no issue type" >&2; exit 10 ;;
  Priority:* | Size:*) echo "set-field.sh: '$3' is not a $2 value" >&2; exit 11 ;;
  *) echo "set-field.sh: unsupported field '$2' (Priority|Size)" >&2; exit 1 ;;
esac

FILE=$(item_file "$NUM") || { echo "no backlog item #$NUM" >&2; exit 12; }
fm_set "$FILE" "$KEY" "$3" || { echo "#$NUM has no frontmatter" >&2; exit 12; }
bash "$(dirname "$0")/render-index.sh" "$ROOT"
echo "#$NUM $2 -> $3"
