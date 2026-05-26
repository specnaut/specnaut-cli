#!/usr/bin/env bash
# Set a native classification value on an issue on Specflow's Project #4:
# the Project V2 single-select fields Priority / Size, or the org-level native
# Issue Type (Task / Bug / Feature). Works across all three repos linked to
# the project (`specflow`, `specflow-cloud`, `specflow-monorepo`).
# Hardcoded mirror of the templated helper at
# templates/core/skills/backlog/scripts/github/set-field.sh.
#
# The item-ID lookup uses a small, targeted GraphQL query (one issue,
# projectItems(first:5)) — negligible quota cost. `gh project item-list` was
# considered as a replacement but would paginate through 200+ items just to
# find one (~12x slower). The bulky multi-issue case is in `list.sh`.
#
# The Project V2 field mutation (`updateProjectV2ItemFieldValue`) is
# GraphQL-only — `gh project item-edit` is the CLI wrapper, used below.
# The Issue Type is set via the REST issues API (`PATCH .../issues/N` with
# `type`) — a single call that takes the type name directly, cheaper than
# the GraphQL `updateIssue` path and with no node-ID resolution.
#
# Usage: set-field.sh [--repo <short>] <issue-number> <Priority|Size|IssueType> <value>
#   <short>   ∈ specflow | specflow-cloud | specflow-monorepo (default: specflow)
#   Priority  → P0 | P1 | P2 | P3
#   Size      → XS | S | M | L | XL
#   IssueType → Task | Bug | Feature
#
# Exit codes:
#   0   field / type updated
#   10  no such field / type on the project / org (caller should fall back to a label)
#   11  field / type present but the value is unrecognised (caller should fall back to a label)
#   12  issue is not on Project #4 / not in the repo
#   1   usage / unexpected error
set -euo pipefail

. "$(dirname "$0")/_repo.sh"
resolve_repo "$@"
set -- ${REPO_REMAINING_ARGS[@]+"${REPO_REMAINING_ARGS[@]}"}

if [ "$#" -lt 3 ]; then
  echo 'usage: set-field.sh [--repo <short>] <issue-number> <Priority|Size|IssueType> <value>' >&2
  exit 1
fi
ISSUE="$1"
FIELD_NAME="$2"
VALUE="$3"

PROJECT_ID="PVT_kwDOBv46cs4BV4Gz"
REPO_NAME="${REPO#mkrlabs/}"

# Issue Type is an org-level native concept, not a Project V2 field — it has
# its own mutation path and exits before the Priority/Size project-field code.
case "$(echo "$FIELD_NAME" | tr '[:upper:]' '[:lower:]')" in
  issuetype | type)
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
    if ! RESULT=$(gh api -X PATCH "repos/$REPO/issues/$ISSUE" \
      -f type="$VALUE" --jq '.type.name' 2>&1); then
      case "$RESULT" in
        *"Validation Failed"* | *422*)
          echo "$REPO has no native issue type '$VALUE' — fall back to a label" >&2
          exit 10
          ;;
        *"Not Found"* | *404*)
          echo "issue #$ISSUE not found in $REPO" >&2
          exit 12
          ;;
        *)
          echo "set IssueType failed: $RESULT" >&2
          exit 1
          ;;
      esac
    fi
    echo "✓ $REPO#$ISSUE IssueType → $RESULT"
    exit 0
    ;;
esac

case "$(echo "$FIELD_NAME" | tr '[:upper:]' '[:lower:]')" in
  priority)
    FIELD_ID="PVTSSF_lADOBv46cs4BV4GzzhRQrbw"
    CANONICAL="Priority"
    case "$VALUE" in
      P0) OPT="093323d6" ;;
      P1) OPT="7b8ac56e" ;;
      P2) OPT="eae399b4" ;;
      P3) OPT="59c235b3" ;;
      *)
        echo "unknown Priority value '$VALUE' (P0|P1|P2|P3)" >&2
        exit 11
        ;;
    esac
    ;;
  size)
    FIELD_ID="PVTSSF_lADOBv46cs4BV4GzzhRQrb0"
    CANONICAL="Size"
    case "$VALUE" in
      XS) OPT="6c6483d2" ;;
      S) OPT="f784b110" ;;
      M) OPT="7515a9f1" ;;
      L) OPT="817d0097" ;;
      XL) OPT="db339eb2" ;;
      *)
        echo "unknown Size value '$VALUE' (XS|S|M|L|XL)" >&2
        exit 11
        ;;
    esac
    ;;
  *)
    echo "error: unsupported field '$FIELD_NAME' (Priority|Size|IssueType)" >&2
    exit 1
    ;;
esac

ITEM_ID=$(gh api graphql -f query='
  query($owner: String!, $name: String!, $num: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $num) {
        projectItems(first: 5) {
          nodes { id project { number } }
        }
      }
    }
  }' -f owner="mkrlabs" -f name="$REPO_NAME" -F num="$ISSUE" \
  | jq -r '.data.repository.issue.projectItems.nodes[] | select(.project.number == 4) | .id')

if [ -z "$ITEM_ID" ]; then
  echo "issue $REPO#$ISSUE is not on Project #4" >&2
  exit 12
fi

gh project item-edit \
  --id "$ITEM_ID" \
  --project-id "$PROJECT_ID" \
  --field-id "$FIELD_ID" \
  --single-select-option-id "$OPT" >/dev/null

echo "✓ $REPO#$ISSUE $CANONICAL → $VALUE"
