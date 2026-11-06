#!/usr/bin/env bash
# Make an existing GitLab issue a child of another: the `parent::#NNN` scoped
# label `add.sh --parent` sets at creation and cascade-check.sh reads.
#
# Usage: link.sh <child-number> <parent-number>
# Exit: 0 linked · 2 usage, or an issue linked to itself · other glab's
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

[ "$#" -eq 2 ] || { echo 'usage: link.sh <child-number> <parent-number>' >&2; exit 2; }
CHILD=$(require_issue_number "$1") || exit 2
PARENT=$(require_issue_number "$2") || exit 2
[ "$CHILD" != "$PARENT" ] || { echo "link.sh: an issue is not its own parent" >&2; exit 2; }

glab issue update "$CHILD" --repo "$PROJECT_ID" --label "parent::#$PARENT" >/dev/null
echo "linked #$CHILD under #$PARENT"
