#!/usr/bin/env bash
# Set a native Project V2 single-select field value (Priority or Size) on an issue.
#
# The item-ID lookup uses a small, targeted GraphQL query (one issue,
# projectItems(first:5)) — negligible quota cost (~2 points). The actual
# field mutation (`updateProjectV2ItemFieldValue`) is GraphQL-only —
# `gh project item-edit` is the CLI wrapper, used below.
#
# Usage: set-field.sh <issue-number> <Priority|Size> <value>
#   Examples:
#     set-field.sh 42 Priority P1
#     set-field.sh 42 Size M
#
# Exit codes:
#   0   field updated
#   10  no such field on the project (caller should fall back to a label)
#   11  field exists but has no option matching <value> (caller should fall back to a label)
#   12  issue is not on the project
#   1   usage / unexpected error
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 3 ]; then
  echo 'usage: set-field.sh <issue-number> <Priority|Size> <value>' >&2
  exit 1
fi
NUM="$1"
FIELD_NAME="$2"
VALUE="$3"

# Normalize field name to one of the canonical labels we support.
FIELD_LOWER=$(echo "$FIELD_NAME" | tr '[:upper:]' '[:lower:]')
case "$FIELD_LOWER" in
  priority) PREFIX="PRIORITY" CANONICAL="Priority" ;;
  size)     PREFIX="SIZE"     CANONICAL="Size" ;;
  *)
    echo "error: unsupported field '$FIELD_NAME' (Priority|Size)" >&2
    exit 1
    ;;
esac

eval "$("$(dirname "$0")/detect-fields.sh")"

FIELD_ID_VAR="${PREFIX}_FIELD_ID"
FIELD_ID="${!FIELD_ID_VAR-}"
if [ -z "$FIELD_ID" ]; then
  echo "no native '$CANONICAL' field on Project #$PROJECT_NUMBER — fall back to label" >&2
  exit 10
fi

VALUE_KEY=$(echo "$VALUE" | tr '[:lower:]' '[:upper:]')
OPT_VAR="${PREFIX}_OPT_${VALUE_KEY}"
OPT_ID="${!OPT_VAR-}"
if [ -z "$OPT_ID" ]; then
  echo "field '$CANONICAL' has no option '$VALUE' — fall back to label" >&2
  exit 11
fi

# Targeted lookup by issue number — much cheaper than fetching the whole
# project item list (a single issue ~2 GraphQL points, vs paginated list).
ITEM_ID=$(gh api graphql -f query='
  query($owner:String!, $name:String!, $num:Int!) {
    repository(owner:$owner, name:$name) {
      issue(number:$num) {
        projectItems(first:5) { nodes { id project { id } } }
      }
    }
  }' -f owner="$REPO_OWNER" -f name="$REPO_NAME" -F num="$NUM" \
  | jq -r --arg p "$PROJECT_NODE_ID" '.data.repository.issue.projectItems.nodes[] | select(.project.id==$p) | .id' | head -1)

if [ -z "$ITEM_ID" ]; then
  echo "issue #$NUM is not on Project #$PROJECT_NUMBER" >&2
  exit 12
fi

gh project item-edit \
  --id "$ITEM_ID" \
  --project-id "$PROJECT_NODE_ID" \
  --field-id "$FIELD_ID" \
  --single-select-option-id "$OPT_ID" >/dev/null

echo "✓ #$NUM $CANONICAL → $VALUE"
