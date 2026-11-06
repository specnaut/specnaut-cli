#!/usr/bin/env bash
# Set a classification on a GitLab issue, as the scoped label item-record.sh
# reads: `priority::P1`, `size::M`, `type::feature`. A scoped label replaces
# the one of the same scope, so a second value never stands beside the first.
#
# Usage: set-field.sh <number> <Priority|Size|IssueType> <value>
# Exit: 0 set · 11 a value outside P0-P3 / XS-XL / Task, Bug, Feature ·
#       1 usage, or glab failed
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

[ "$#" -eq 3 ] || { echo 'usage: set-field.sh <number> <Priority|Size|IssueType> <value>' >&2; exit 1; }
NUM=$(require_issue_number "$1") || exit 1
case "$2:$3" in
  Priority:P[0-3]) LABEL="priority::$3" ;;
  Size:XS | Size:S | Size:M | Size:L | Size:XL) LABEL="size::$3" ;;
  IssueType:Task | IssueType:Bug | IssueType:Feature) LABEL="type::$(printf '%s' "$3" | tr '[:upper:]' '[:lower:]')" ;;
  Priority:* | Size:* | IssueType:*) echo "set-field.sh: '$3' is not a $2 value" >&2; exit 11 ;;
  *) echo "set-field.sh: unsupported field '$2' (Priority|Size|IssueType)" >&2; exit 1 ;;
esac

glab issue update "$NUM" --repo "$PROJECT_ID" --label "$LABEL" >/dev/null || exit 1
echo "#$NUM $2 -> $3"
