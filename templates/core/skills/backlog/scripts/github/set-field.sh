#!/usr/bin/env bash
# Set a native classification value on an issue: the Project V2 single-select
# fields Priority / Size, or the org-level native Issue Type (Task / Bug /
# Feature).
#
# The item-ID lookup uses a small, targeted GraphQL query (one issue,
# projectItems(first:5)) — negligible quota cost (~2 points). The Project V2
# field mutation (`updateProjectV2ItemFieldValue`) is GraphQL-only —
# `gh project item-edit` is the CLI wrapper, used below. The Issue Type is
# set via the REST issues API (`PATCH .../issues/N` with `type`) — a single
# call that takes the type name directly, cheaper than the GraphQL
# `updateIssue` path and with no node-ID resolution.
#
# Usage: set-field.sh <issue-number> <Priority|Size|IssueType|StartDate|TargetDate|Estimate> <value>
#   Examples:
#     set-field.sh 42 Priority    P1
#     set-field.sh 42 Size        M
#     set-field.sh 42 IssueType   Feature
#     set-field.sh 42 StartDate   2026-05-16
#     set-field.sh 42 TargetDate  2026-06-30
#     set-field.sh 42 Estimate    3
#
# Date axes accept ISO 8601 (YYYY-MM-DD). Estimate is a numeric value
# (story points or days, project's choice). Date / Estimate fields are
# part of the Project V2 board (#264); they're what the Roadmap view
# plots along its timeline.
#
# Issue Types are an org-level GitHub feature. On user-owned repos (no org)
# the org query returns nothing and the script exits 10 so the caller falls
# back to a `type:*` label.
#
# Exit codes:
#   0   field / type updated
#   10  no such field / type on the project / org (caller should fall back to a label)
#   11  field / type present but the value is unrecognised (Priority/Size/IssueType only — date/number axes defer to gh for value validation)
#   12  issue is not on the project / not in the repo
#   1   usage / unexpected error
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 3 ]; then
  echo 'usage: set-field.sh <issue-number> <Priority|Size|IssueType|StartDate|TargetDate|Estimate> <value>' >&2
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
  # Single REST PATCH — takes the type name directly. A 422 means the
  # repo/org has no such native type (fall back to a label); a 404 means
  # the issue doesn't exist.
  if ! RESULT=$(gh api -X PATCH "repos/$REPO_OWNER/$REPO_NAME/issues/$NUM" \
    -f type="$VALUE" --jq '.type.name' 2>&1); then
    case "$RESULT" in
      *"Validation Failed"* | *422*)
        echo "$REPO_OWNER/$REPO_NAME has no native issue type '$VALUE' — fall back to a label" >&2
        exit 10
        ;;
      *"Not Found"* | *404*)
        echo "issue #$NUM not found in $REPO_OWNER/$REPO_NAME" >&2
        exit 12
        ;;
      *)
        echo "set IssueType failed: $RESULT" >&2
        exit 1
        ;;
    esac
  fi
  echo "✓ #$NUM IssueType → $RESULT"
  exit 0
fi

# Date / number Project V2 fields (#264 — Roadmap inputs). They don't
# have option IDs — `gh project item-edit` takes the raw value via
# --date (ISO 8601) or --number. The field discovery still runs through
# detect-fields.sh; missing field → exit 10 (caller surfaces "field
# absent on project" warning, same contract as Priority/Size).
case "$FIELD_LOWER" in
  startdate | targetdate | estimate)
    case "$FIELD_LOWER" in
      startdate)  PREFIX="STARTDATE"  CANONICAL="Start date"  KIND="date" ;;
      targetdate) PREFIX="TARGETDATE" CANONICAL="Target date" KIND="date" ;;
      estimate)   PREFIX="ESTIMATE"   CANONICAL="Estimate"    KIND="number" ;;
    esac

    eval "$("$(dirname "$0")/detect-fields.sh")"

    FIELD_ID_VAR="${PREFIX}_FIELD_ID"
    FIELD_ID="${!FIELD_ID_VAR-}"
    if [ -z "$FIELD_ID" ]; then
      echo "no native '$CANONICAL' field on Project #$PROJECT_NUMBER — fall back to label or skip" >&2
      exit 10
    fi

    # Targeted item-ID lookup, same shape as the Priority/Size path
    # below — one issue, projectItems(first:5), filter on PROJECT_NODE_ID.
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

    if [ "$KIND" = "date" ]; then
      gh project item-edit \
        --id "$ITEM_ID" \
        --project-id "$PROJECT_NODE_ID" \
        --field-id "$FIELD_ID" \
        --date "$VALUE" >/dev/null
    else
      gh project item-edit \
        --id "$ITEM_ID" \
        --project-id "$PROJECT_NODE_ID" \
        --field-id "$FIELD_ID" \
        --number "$VALUE" >/dev/null
    fi

    echo "✓ #$NUM $CANONICAL → $VALUE"
    exit 0
    ;;
esac

case "$FIELD_LOWER" in
  priority) PREFIX="PRIORITY" CANONICAL="Priority" ;;
  size)     PREFIX="SIZE"     CANONICAL="Size" ;;
  *)
    echo "error: unsupported field '$FIELD_NAME' (Priority|Size|IssueType|StartDate|TargetDate|Estimate)" >&2
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
