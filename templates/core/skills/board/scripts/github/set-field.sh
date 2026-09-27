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
# what the Roadmap view plots along its timeline (#264). A date — like
# Priority / Size — may be the project's own or an organization issue
# field; each form takes its own mutation (see `set_issue_field`).
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
#   13  field discovery FAILED (rate limit, bad token, any gh error) — NOT a
#       fallback signal: the field may well exist, so the caller must not apply
#       a label; retry, or report the value as not persisted
#   2   backlog-config.yml missing / incomplete, or its project does not resolve
#   1   usage / unexpected error
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"
require_project   # a project that does not resolve fails here, not mid-write

if [ "$#" -lt 3 ]; then
  echo 'usage: set-field.sh <issue-number> <Priority|Size|IssueType|StartDate|TargetDate|Estimate> <value>' >&2
  exit 1
fi
NUM="$1"
FIELD_NAME="$2"
VALUE="$3"

# Run detect-fields.sh and load its answer — only a COMPLETE answer.
#
# Not `eval "$(detect-fields.sh)"`: `eval` returns its own status, not the
# substituted command's, and `eval ""` is 0, so `set -e` never fires. A detector
# that died left every `*_FIELD_ID` unset, and the absent-field guard below then
# answered exit 10 — "fall back to a label" — for a field that may well exist.
# That is the dual-signal drift this script exists to prevent, caused by a
# transient fault and reported as a normal outcome. Output and status are
# therefore captured apart, and output from a failed run is discarded whole: a
# detector that died after emitting some fields is not half-right.
load_fields() {
  local fields
  if ! fields=$("$(dirname "$0")/detect-fields.sh"); then
    echo "field discovery failed on Project #$PROJECT_NUMBER — the field may exist; do not fall back to a label (retry, or report '$FIELD_NAME' as not persisted)" >&2
    exit 13
  fi
  eval "$fields"
}

# Write an ORGANIZATION issue field's value on the issue itself.
#
# `updateProjectV2ItemFieldValue` addresses a project ITEM; an issue-level
# field's value lives on the ISSUE, against the organization's field, so the
# issue need not be a project item at all — only an issue that does not exist
# is exit 12. `setIssueFieldValue` rather than `updateIssueFieldValue` /
# `createIssueFieldValue`: those require the value to already exist / not exist,
# so either forces a read-before-write to choose, with a race in the gap. `set`
# is the idempotent upsert. One write shape for every issue-level axis; they
# differ only in the value slot of `IssueFieldCreateOrUpdateInput`.
#
# Usage: set_issue_field <org-field-id> <slot> <slot-graphql-type> <value>
#   e.g. set_issue_field IFSS_x singleSelectOptionId ID!     <option-id>
#        set_issue_field IFD_x  dateValue            String! 2026-06-30
set_issue_field() {
  local field="$1" slot="$2" type="$3" value="$4" issue_id
  issue_id=$(gh issue view "$NUM" --repo "$REPO" --json id --jq '.id' 2>/dev/null || true)
  if [ -z "$issue_id" ]; then
    echo "issue #$NUM not found in $REPO" >&2
    exit 12
  fi
  gh api graphql -f query="
    mutation(\$issue: ID!, \$field: ID!, \$value: $type) {
      setIssueFieldValue(input: {
        issueId: \$issue,
        issueFields: [{ fieldId: \$field, $slot: \$value }]
      }) { clientMutationId }
    }" -f issue="$issue_id" -f field="$field" -f value="$value" >/dev/null
}

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
# absent on project" warning, same contract as Priority/Size); failed
# discovery → exit 13.
case "$FIELD_LOWER" in
  startdate | targetdate | estimate)
    case "$FIELD_LOWER" in
      startdate)  PREFIX="STARTDATE"  CANONICAL="Start date"  KIND="date" ;;
      targetdate) PREFIX="TARGETDATE" CANONICAL="Target date" KIND="date" ;;
      estimate)   PREFIX="ESTIMATE"   CANONICAL="Estimate"    KIND="number" ;;
    esac

    load_fields

    FIELD_ID_VAR="${PREFIX}_FIELD_ID"
    FIELD_ID="${!FIELD_ID_VAR-}"
    if [ -z "$FIELD_ID" ]; then
      echo "no native '$CANONICAL' field on Project #$PROJECT_NUMBER — fall back to label or skip" >&2
      exit 10
    fi

    # An issue-level date: the project lists it, but its value lives on the
    # issue and the project mutation refuses it, whatever id the listing
    # showed. detect-fields.sh decided the form; this only follows it.
    FORM_VAR="${PREFIX}_FIELD_FORM"
    if [ "$KIND" = "date" ] && [ "${!FORM_VAR-local}" = "projected" ]; then
      ORG_FIELD_VAR="${PREFIX}_ORG_FIELD_ID"
      ORG_FIELD_ID="${!ORG_FIELD_VAR-}"
      if [ -z "$ORG_FIELD_ID" ]; then
        echo "'$CANONICAL' is an issue-level field but its organization field id is unknown — skip" >&2
        exit 10
      fi
      set_issue_field "$ORG_FIELD_ID" dateValue 'String!' "$VALUE"
      echo "✓ #$NUM $CANONICAL → $VALUE (organization field)"
      exit 0
    fi

    # Targeted item-ID lookup — `_config.sh` owns the query (#603).
    ITEM_ID=$(project_item_id "$NUM")

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

load_fields

FIELD_ID_VAR="${PREFIX}_FIELD_ID"
FIELD_ID="${!FIELD_ID_VAR-}"
if [ -z "$FIELD_ID" ]; then
  echo "no native '$CANONICAL' field on Project #$PROJECT_NUMBER — fall back to label" >&2
  exit 10
fi

VALUE_KEY=$(echo "$VALUE" | tr '[:lower:]' '[:upper:]' | tr -c 'A-Z0-9\n' '_')
OPT_VAR="${PREFIX}_OPT_${VALUE_KEY}"
OPT_ID="${!OPT_VAR-}"
if [ -z "$OPT_ID" ]; then
  # Matched by NAME, never mapped. A projected organization field may use a
  # different vocabulary than the project-local one of the same name — on this
  # org, project-local `Priority` is P0..P3 while the organization's `Priority`
  # is Urgent/High/Medium/Low. Translating between them would be a silent
  # mis-write dressed as helpfulness; exit 11 hands the value to a label, which
  # is visibly approximate and already the documented contract.
  echo "field '$CANONICAL' has no option '$VALUE' — fall back to label" >&2
  exit 11
fi

# A PROJECTED organization field is not written through the project — see
# `set_issue_field` for the mutation and why it is that one.
FORM_VAR="${PREFIX}_FIELD_FORM"
FORM="${!FORM_VAR-local}"
if [ "$FORM" = "projected" ]; then
  ORG_FIELD_VAR="${PREFIX}_ORG_FIELD_ID"
  ORG_FIELD_ID="${!ORG_FIELD_VAR-}"
  if [ -z "$ORG_FIELD_ID" ]; then
    echo "'$CANONICAL' is projected but its organization field id is unknown — fall back to label" >&2
    exit 10
  fi
  set_issue_field "$ORG_FIELD_ID" singleSelectOptionId 'ID!' "$OPT_ID"
  echo "✓ #$NUM $CANONICAL → $VALUE (organization field)"
  exit 0
fi

# Targeted lookup by issue number — `_config.sh` owns the query (#603).
ITEM_ID=$(project_item_id "$NUM")

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
