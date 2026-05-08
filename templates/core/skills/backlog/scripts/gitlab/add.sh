#!/usr/bin/env bash
# Create a GitLab Issue with the Status::Backlog scoped label.
# Usage: add.sh "<title>" [body] [labels-csv]
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 1 ]; then
  echo 'usage: add.sh "<title>" [body] [labels-csv]' >&2
  exit 2
fi
TITLE="$1"
BODY="${2:-}"
EXTRA_LABELS="${3:-}"

LABELS="Status::Backlog"
if [ -n "$EXTRA_LABELS" ]; then
  LABELS="$LABELS,$EXTRA_LABELS"
fi

ARGS=(
  "--repo" "$PROJECT_ID"
  "--title" "$TITLE"
  "--label" "$LABELS"
  "--description" "$BODY"
)

URL=$(glab issue create "${ARGS[@]}" 2>&1 | grep -oE 'https://[^ ]+' | head -1)
echo "✓ created: $URL"
