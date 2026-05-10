#!/usr/bin/env bash
# Verify that a parent issue is safe to close — every child tagged with
# the `parent::#NNN` scoped label must already be closed. Refuses (exit
# 11) otherwise so the PO can surface the open children and finish them
# first.
#
# Usage:   cascade-check.sh <issue-number>
# Exit:    0  parent has no open children — safe to close
#          11 at least one child is still open — close blocked
#          2  usage error
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 1 ]; then
  echo 'usage: cascade-check.sh <issue-number>' >&2
  exit 2
fi
NUM="$1"

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
