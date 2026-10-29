#!/usr/bin/env bash
# Move an issue to a new status by swapping the Status:: scoped label.
# Scoped labels on the same scope are mutually exclusive in GitLab, so
# adding the new one removes the old one atomically.
# Usage: move.sh <number> <Status>
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 2 ]; then
  echo 'usage: move.sh <number> <Status>' >&2
  echo '  Status one of: Backlog, Ready, "In progress", "In review", Done' >&2
  exit 2
fi
NUM="$1"
STATUS="$2"

case "$STATUS" in
  Backlog|Ready|"In progress"|"In review"|Done) ;;
  *)
    echo "unknown status '$STATUS' — expected: Backlog, Ready, 'In progress', 'In review', Done" >&2
    exit 2
    ;;
esac

# Find the existing Status:: label and remove it; add the new one.
EXISTING=$(glab issue view "$NUM" --repo "$PROJECT_ID" --output json 2>/dev/null \
  | jq -r '.labels[]? | select(startswith("Status::"))' | head -1 || true)

if [ -n "$EXISTING" ]; then
  glab issue update "$NUM" --repo "$PROJECT_ID" \
    --unlabel "$EXISTING" >/dev/null
fi

glab issue update "$NUM" --repo "$PROJECT_ID" \
  --label "Status::$STATUS" >/dev/null

echo "✓ #$NUM → Status::$STATUS"
