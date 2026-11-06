#!/usr/bin/env bash
# Link an existing issue as a sub-issue of another, through GitHub's
# `/sub_issues` endpoint — the link `add.sh --parent` makes at creation.
#
# Usage: link.sh <child-number> <parent-number>
# Exit: 0 linked · 2 usage, or an issue linked to itself · 3 the child could not be read · other gh's
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

[ "$#" -eq 2 ] || { echo 'usage: link.sh <child-number> <parent-number>' >&2; exit 2; }
CHILD=$(require_issue_number "$1") || exit 2
PARENT=$(require_issue_number "$2") || exit 2
[ "$CHILD" != "$PARENT" ] || { echo "link.sh: an issue is not its own parent" >&2; exit 2; }

# sub_issues is keyed by the child's REST id, not its number.
CHILD_ID=$(gh api "repos/$REPO_OWNER/$REPO_NAME/issues/$CHILD" --jq '.id') ||
  { echo "link.sh: could not read #$CHILD" >&2; exit 3; }
[[ $CHILD_ID =~ ^[0-9]+$ ]] || { echo "link.sh: #$CHILD has no id" >&2; exit 3; }
gh api -X POST "repos/$REPO_OWNER/$REPO_NAME/issues/$PARENT/sub_issues" -F sub_issue_id="$CHILD_ID" >/dev/null
echo "linked #$CHILD under #$PARENT"
