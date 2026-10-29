#!/usr/bin/env bash
# Move several issues to the same Status in one round-trip.
#
# `move.sh` is the single-item path and costs one lookup plus one mutation per
# issue. Looping it over N cards is N times that, and the backlog contract is
# explicit that a multi-item mutation goes out as one request — a board sweep
# after a busy merge is exactly the case it was written for.
#
# This resolves every item id in ONE query, then emits ONE multi-alias mutation
# (`m0:`, `m1:`, …). N cards cost 2 requests, not 2N.
#
# It deliberately does NOT run the parent-epic propagation hook that `move.sh`
# fires. Propagation is a per-item state machine with its own recursion guard;
# folding it in would make a batch move mean something different from N single
# moves. Callers that need it should use `move.sh` for those items.
#
# Output: one `✓ #<n> → <Status>` per moved card, then a summary. Issues not on
# the project are reported and skipped — one absent card never aborts the rest.
#
# Usage: move-batch.sh <Status> <number>...
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 2 ]; then
  echo 'usage: move-batch.sh <Status> <number>...' >&2
  echo '  Status one of: Backlog, Ready, "In progress", "In review", Done' >&2
  exit 2
fi
STATUS="$1"
shift

PROJECT_NODE_ID=$(gh project view "$PROJECT_NUMBER" --owner "$REPO_OWNER" --format json | jq -r '.id')
STATUS_FIELD_JSON=$(gh project field-list "$PROJECT_NUMBER" --owner "$REPO_OWNER" --format json)
STATUS_FIELD_ID=$(echo "$STATUS_FIELD_JSON" | jq -r '.fields[] | select(.name=="Status") | .id')
OPTION_ID=$(echo "$STATUS_FIELD_JSON" | jq -r --arg s "$STATUS" '.fields[] | select(.name=="Status") | .options[] | select(.name==$s) | .id')
if [ -z "$OPTION_ID" ] || [ "$OPTION_ID" = "null" ]; then
  echo "unknown status '$STATUS' in Project #$PROJECT_NUMBER" >&2
  exit 1
fi

# --- one query: every item id in a single aliased request -------------------
Q='query($owner:String!, $name:String!) { repository(owner:$owner, name:$name) {'
i=0
for n in "$@"; do
  Q="$Q i$i: issue(number:$n) { number projectItems(first:5) { nodes { id project { id } } } }"
  i=$((i + 1))
done
Q="$Q } }"

RESOLVED="$(gh api graphql -f query="$Q" -f owner="$REPO_OWNER" -f name="$REPO_NAME" \
  | jq -c --arg p "$PROJECT_NODE_ID" '
      [ .data.repository | to_entries[] | select(.value != null)
        | { number: .value.number,
            id: ([.value.projectItems.nodes[] | select(.project.id == $p) | .id] | first) } ]')"

MISSING="$(echo "$RESOLVED" | jq -r '.[] | select(.id == null) | .number')"
TARGETS="$(echo "$RESOLVED" | jq -c '[ .[] | select(.id != null) ]')"
COUNT="$(echo "$TARGETS" | jq 'length')"

for n in $MISSING; do
  echo "⚠ #$n is not on Project #$PROJECT_NUMBER — skipped" >&2
done

if [ "$COUNT" -eq 0 ]; then
  echo "moved 0 of $# — none of the requested issues are on Project #$PROJECT_NUMBER" >&2
  exit 1
fi

# --- one mutation: every field write in a single aliased request ------------
M='mutation {'
i=0
for id in $(echo "$TARGETS" | jq -r '.[].id'); do
  M="$M m$i: updateProjectV2ItemFieldValue(input: {projectId: \"$PROJECT_NODE_ID\", itemId: \"$id\", fieldId: \"$STATUS_FIELD_ID\", value: {singleSelectOptionId: \"$OPTION_ID\"}}) { projectV2Item { id } }"
  i=$((i + 1))
done
M="$M }"

gh api graphql -f query="$M" >/dev/null

echo "$TARGETS" | jq -r --arg s "$STATUS" '.[] | "✓ #\(.number) → \($s)"'
echo "moved $COUNT of $# in 2 requests"
