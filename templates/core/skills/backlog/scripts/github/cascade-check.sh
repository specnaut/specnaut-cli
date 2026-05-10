#!/usr/bin/env bash
# Verify that a parent issue is safe to close — every linked sub-issue
# must already be closed. Refuses (exit 11) otherwise so the PO can
# surface the open children and finish them first.
#
# Usage:   cascade-check.sh <issue-number>
# Exit:    0  parent has no open children — safe to close
#          11 at least one child is still open — close blocked
#          12 parent is already closed — nothing to gate (short-circuit)
#          3  parent issue does not exist
#          2  usage error
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 1 ]; then
  echo 'usage: cascade-check.sh <issue-number>' >&2
  exit 2
fi
NUM="$1"

# One API call covers existence + state. Empty stdout = the issue is not
# reachable (404 or transient) — same exit-3 contract as the previous
# two-call shape, one fewer round trip.
PARENT_STATE=$(gh api "repos/$REPO_OWNER/$REPO_NAME/issues/$NUM" --jq '.state' 2>/dev/null || true)
if [ -z "$PARENT_STATE" ]; then
  echo "✗ issue #$NUM not found in $REPO_OWNER/$REPO_NAME" >&2
  exit 3
fi

# Already-closed short-circuit: callers that trust exit 0 would issue a
# redundant `gh issue close` and get a 422. Surface this explicitly so
# wrappers (PO agent, CI) treat non-zero as "stop, don't close again".
if [ "$PARENT_STATE" = "closed" ]; then
  echo "ℹ #$NUM is already closed — nothing to gate"
  exit 12
fi

# Native sub-issues endpoint (beta). Returns [] when no children exist.
OPEN=$(gh api "repos/$REPO_OWNER/$REPO_NAME/issues/$NUM/sub_issues" \
  --jq '[.[] | select(.state=="open")] | length' 2>/dev/null || echo 0)

if [ "$OPEN" -gt 0 ]; then
  echo "✗ #$NUM has $OPEN open child issue(s) — close them first"
  gh api "repos/$REPO_OWNER/$REPO_NAME/issues/$NUM/sub_issues" \
    --jq '.[] | select(.state=="open") | "  - #\(.number) — \(.title)"'
  exit 11
fi

echo "✓ #$NUM safe to close (no open children)"
exit 0
