#!/usr/bin/env bash
# Make an existing backlog item a sub-task of another: the `parent: "#NNN"`
# frontmatter and the `## Sub-tasks` line `add.sh --parent` writes at creation.
#
# Usage: link.sh <child-number> <parent-number>
# Exit: 0 linked · 1 an item does not exist · 2 usage, or an item linked to itself
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

[ "$#" -eq 2 ] || { echo 'usage: link.sh <child-number> <parent-number>' >&2; exit 2; }
CHILD=$(require_issue_number "$1") || exit 2
PARENT=$(require_issue_number "$2") || exit 2
[ "$CHILD" != "$PARENT" ] || { echo "link.sh: an item is not its own parent" >&2; exit 2; }
CHILD_FILE=$(item_file "$CHILD") || { echo "no backlog item #$CHILD" >&2; exit 1; }
PARENT_FILE=$(item_file "$PARENT") || { echo "no backlog item #$PARENT" >&2; exit 1; }
PADDED=$(printf '%03d' "$PARENT")

fm_set "$CHILD_FILE" parent "\"#$PADDED\"" || { echo "#$CHILD has no frontmatter" >&2; exit 1; }
TITLE=$(awk 'NR > 1 && /^---[[:space:]]*$/ { exit } /^title:/ { sub(/^title:[[:space:]]*/, ""); print; exit }' "$CHILD_FILE")
grep -q '^## Sub-tasks$' "$PARENT_FILE" || printf '\n## Sub-tasks\n\n' >>"$PARENT_FILE"
printf -- '- #%03d — %s\n' "$CHILD" "$TITLE" >>"$PARENT_FILE"

bash "$(dirname "$0")/render-index.sh" "$ROOT"
echo "linked #$CHILD under #$PARENT"
