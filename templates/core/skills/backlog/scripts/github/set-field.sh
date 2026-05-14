#!/usr/bin/env bash
# Set a native classification value on an issue: the Project V2 single-select
# fields Priority / Size, or the org-level native Issue Type (Task / Bug /
# Feature).
#
# The item-ID lookup uses a small, targeted GraphQL query (one issue,
# projectItems(first:5)) — negligible quota cost (~2 points). The Project V2
# field mutation (`updateProjectV2ItemFieldValue`) is GraphQL-only —
# `gh project item-edit` is the CLI wrapper, used below. The Issue Type
# mutation (`updateIssue` with `issueTypeId`) is also GraphQL-only and is
# called raw, since `gh issue edit --type` is not available everywhere.
#
# Usage: set-field.sh <issue-number> <Priority|Size|IssueType> <value>
#   Examples:
#     set-field.sh 42 Priority P1
#     set-field.sh 42 Size M
#     set-field.sh 42 IssueType Feature
#
# Issue Types are an org-level GitHub feature. On user-owned repos (no org)
# the org query returns nothing and the script exits 10 so the caller falls
# back to a `type:*` label.
#
# Exit codes:
#   0   field / type updated
#   10  no such field / type on the project / org (caller should fall back to a label)
#   11  field / type present but the value is unrecognised (caller should fall back to a label)
#   12  issue is not on the project / not in the repo
#   1   usage / unexpected error
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 3 ]; then
  echo 'usage: set-field.sh <issue-number> <Priority|Size|IssueType> <value>' >&2
  exit 1
fi
NUM="$1"
FIELD_NAME="$2"
VALUE="$3"

# Normalize field name to one of the canonical labels we support.
FIELD_LOWER=$(echo "$FIELD_NAME" | tr '[:upper:]' '[:lower:]')

# Issue Type is an org-level native concept, not a Project V2 field — it has
# its own mutation path and exits before the Priority/Size project-field code.
if [ "$FIELD_LOWER" = "issuetype" ] || [ "$FIELD_LOWER" = "type" ]; then
  case "$VALUE" in
    Task | Bug | Feature) ;;
    *)
      echo "unknown IssueType value '$VALUE' (Task|Bug|Feature)" >&2
      exit 11
      ;;
  esac
  # Resolve the org issue-type ID dynamically — IDs are org-scoped and worth
  # nothing hard-coded in a template.
  TYPE_ID=$(gh api graphql -f query='
    query($owner: String!) {
      organization(login: $owner) {
        issueTypes(first: 20) { nodes { id name } }
      }
    }' -f owner="$REPO_OWNER" \
    | jq -r --arg v "$VALUE" '.data.organization.issueTypes.nodes[]? | select(.name == $v) | .id')
  if [ -z "$TYPE_ID" ] || [ "$TYPE_ID" = "null" ]; then
    echo "owner '$REPO_OWNER' has no native issue type '$VALUE' — fall back to a label" >&2
    exit 10
  fi
  ISSUE_NODE_ID=$(gh api graphql -f query='
    query($owner: String!, $name: String!, $num: Int!) {
      repository(owner: $owner, name: $name) {
        issue(number: $num) { id }
      }
    }' -f owner="$REPO_OWNER" -f name="$REPO_NAME" -F num="$NUM" \
    | jq -r '.data.repository.issue.id')
  if [ -z "$ISSUE_NODE_ID" ] || [ "$ISSUE_NODE_ID" = "null" ]; then
    echo "issue #$NUM not found in $REPO_OWNER/$REPO_NAME" >&2
    exit 12
  fi
  gh api graphql -f query='
    mutation($id: ID!, $typeId: ID!) {
      updateIssue(input: { id: $id, issueTypeId: $typeId }) {
        issue { issueType { name } }
      }
    }' -f id="$ISSUE_NODE_ID" -f typeId="$TYPE_ID" >/dev/null
  echo "✓ #$NUM IssueType → $VALUE"
  exit 0
fi

case "$FIELD_LOWER" in
  priority) PREFIX="PRIORITY" CANONICAL="Priority" ;;
  size)     PREFIX="SIZE"     CANONICAL="Size" ;;
  *)
    echo "error: unsupported field '$FIELD_NAME' (Priority|Size|IssueType)" >&2
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
