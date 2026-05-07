#!/usr/bin/env bash
# Create a GitHub Issue and attach it to the configured Project.
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
LABELS="${3:-}"

ARGS=("--repo" "$REPO" "--title" "$TITLE")
if [ -n "$BODY" ]; then ARGS+=("--body" "$BODY"); else ARGS+=("--body" ""); fi
if [ -n "$LABELS" ]; then ARGS+=("--label" "$LABELS"); fi

URL=$(gh issue create "${ARGS[@]}")
echo "✓ created: $URL"

# Attach to the project
gh project item-add "$PROJECT_NUMBER" --owner "$REPO_OWNER" --url "$URL" >/dev/null
echo "✓ attached to Project #$PROJECT_NUMBER"
