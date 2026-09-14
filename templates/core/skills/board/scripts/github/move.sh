#!/usr/bin/env bash
# Move an issue's Project Status to <Status>.
#
# The item-ID lookup uses a small, targeted GraphQL query (one issue,
# projectItems(first:5)) — negligible quota cost (~2 points). The actual
# field mutation (`updateProjectV2ItemFieldValue`) is GraphQL-only —
# `gh project item-edit` is the CLI wrapper, used below.
#
# Usage: move.sh <number> <Status>
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"
require_project   # a project that does not resolve fails here, not mid-write

if [ "$#" -lt 2 ]; then
  echo 'usage: move.sh <number> <Status>' >&2
  echo '  Status one of: Backlog, Ready, "In progress", "In review", Done' >&2
  exit 2
fi
NUM="$1"
STATUS="$2"

# Resolve project + status field IDs lazily (cached client-side per call).
PROJECT_NODE_ID=$(gh project view "$PROJECT_NUMBER" --owner "$REPO_OWNER" --format json | jq -r '.id')
STATUS_FIELD_JSON=$(gh project field-list "$PROJECT_NUMBER" --owner "$REPO_OWNER" --format json)
STATUS_FIELD_ID=$(echo "$STATUS_FIELD_JSON" | jq -r '.fields[] | select(.name=="Status") | .id')
OPTION_ID=$(echo "$STATUS_FIELD_JSON" | jq -r --arg s "$STATUS" '.fields[] | select(.name=="Status") | .options[] | select(.name==$s) | .id')

if [ -z "$OPTION_ID" ] || [ "$OPTION_ID" = "null" ]; then
  echo "unknown status '$STATUS' in Project #$PROJECT_NUMBER" >&2
  exit 1
fi

# Targeted lookup by issue number — much cheaper than fetching the whole
# project item list (a single issue ~2 GraphQL points, vs paginated list).
# The query lives in `_config.sh` because `add.sh` asks the same question when
# a project workflow beats it to the attach (#603); two spellings of one lookup
# is how they drift.
ITEM_ID=$(project_item_id "$NUM")

if [ -z "$ITEM_ID" ]; then
  echo "issue #$NUM is not on Project #$PROJECT_NUMBER" >&2
  exit 1
fi

gh project item-edit \
  --id "$ITEM_ID" \
  --project-id "$PROJECT_NODE_ID" \
  --field-id "$STATUS_FIELD_ID" \
  --single-select-option-id "$OPTION_ID" >/dev/null

echo "✓ #$NUM → $STATUS"

# Post-move hook: promote the parent Epic if this was a sub-issue
# leaving Backlog. Best-effort — never blocks on failure. See
# propagate-parent-status.sh for the full state machine.
PROPAGATE="$(dirname "$0")/propagate-parent-status.sh"
if [ -x "$PROPAGATE" ]; then
  "$PROPAGATE" "$NUM" "$STATUS" || true
fi
