#!/usr/bin/env bash
# Close a GitHub issue with its reason. It checks no gate: the executor runs
# cascade-check.sh first, and moves the card to Done after.
#
# Usage: close.sh <number> [completed|not_planned]   (completed by default)
# Exit: 0 closed · 2 usage · other gh's
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

[ "$#" -ge 1 ] && [ "$#" -le 2 ] || { echo 'usage: close.sh <number> [completed|not_planned]' >&2; exit 2; }
NUM=$(require_issue_number "$1") || exit 2
case "${2:-completed}" in
  completed) REASON=completed ;;
  not_planned) REASON="not planned" ;;
  *) echo "close.sh: a reason is completed or not_planned" >&2; exit 2 ;;
esac

gh issue close "$NUM" --repo "$REPO" --reason "$REASON" >/dev/null
echo "closed #$NUM"
