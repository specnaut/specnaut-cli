#!/usr/bin/env bash
# Verify that a parent issue is safe to close — every child tagged with
# the `parent::#NNN` scoped label must already be closed. Refuses (exit
# 11) otherwise so the PO can surface the open children and finish them
# first.
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

# Existence + state in one glab call. Mirrors the GitHub backend so both
# variants share the exit-code contract (3 = missing, 12 = already closed,
# 11 = open children, 0 = safe). GitLab issue states are `opened`/`closed`.
PARENT_STATE=$(glab issue view "$NUM" --repo "$PROJECT_ID" --output json 2>/dev/null \
  | jq -r '.state // empty' 2>/dev/null || true)
if [ -z "$PARENT_STATE" ]; then
  echo "✗ issue #$NUM not found in $PROJECT_ID" >&2
  exit 3
fi

if [ "$PARENT_STATE" = "closed" ]; then
  echo "ℹ #$NUM is already closed — nothing to gate"
  exit 12
fi

# Children carry a scoped label `parent::#NNN`. Ask glab for open issues
# with that label; output is one issue per line on the standard format.
OPEN=$(glab issue list --repo "$PROJECT_ID" \
  --label "parent::#$NUM" --opened 2>/dev/null | wc -l | tr -d ' ')

if [ "$OPEN" -gt 0 ]; then
  echo "✗ #$NUM has $OPEN open child issue(s) — close them first"
  glab issue list --repo "$PROJECT_ID" --label "parent::#$NUM" --opened 2>/dev/null \
    | sed 's/^/  /'
  exit 11
fi

echo "✓ #$NUM safe to close (no open children with parent::#$NUM)"
exit 0
