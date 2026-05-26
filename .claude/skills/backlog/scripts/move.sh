#!/usr/bin/env bash
# Move a backlog issue to a Status column on Project #4. Works across all
# three repos linked to the project (`specflow`, `specflow-cloud`,
# `specflow-monorepo`).
#
# The item-ID lookup uses a small, targeted GraphQL query (one issue,
# projectItems(first:5)) — query complexity ~5 nodes, negligible quota cost.
# `gh project item-list` was considered as a replacement but would paginate
# through 200+ items (~5s, ~12x slower) just to find one. The bulky multi-
# issue case lives in `list.sh` and uses the CLI directly.
#
# The actual field mutation (`updateProjectV2ItemFieldValue`) is GraphQL-only
# — `gh project item-edit` is the CLI wrapper, used below.
#
# Usage: move.sh [--repo <short>] <ISSUE_NUMBER> <STATUS>
#   <short> ∈ specflow | specflow-cloud | specflow-monorepo (default: specflow)
#   STATUS  ∈ Backlog | Ready | "In progress" | "In review" | Done
set -euo pipefail

. "$(dirname "$0")/_repo.sh"
resolve_repo "$@"
set -- ${REPO_REMAINING_ARGS[@]+"${REPO_REMAINING_ARGS[@]}"}

ISSUE="${1:?usage: move.sh [--repo <short>] <issue-number> <status>}"
STATUS="${2:?usage: move.sh [--repo <short>] <issue-number> <status>}"

PROJECT_ID="PVT_kwDOBv46cs4BV4Gz"
STATUS_FIELD_ID="PVTSSF_lADOBv46cs4BV4GzzhRQrX8"

case "$STATUS" in
  Backlog) OPT="f75ad846" ;;
  Ready) OPT="61e4505c" ;;
  "In progress") OPT="47fc9ee4" ;;
  "In review") OPT="df73e18b" ;;
  Done) OPT="98236657" ;;
  *)
    echo "unknown status: $STATUS (Backlog|Ready|\"In progress\"|\"In review\"|Done)" >&2
    exit 1
    ;;
esac

REPO_NAME="${REPO#mkrlabs/}"
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

if [[ -z "$ITEM_ID" ]]; then
  echo "issue $REPO#$ISSUE is not on Project #4" >&2
  exit 1
fi

gh project item-edit \
  --id "$ITEM_ID" \
  --project-id "$PROJECT_ID" \
  --field-id "$STATUS_FIELD_ID" \
  --single-select-option-id "$OPT" >/dev/null

echo "moved $REPO#$ISSUE → $STATUS"
