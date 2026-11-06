#!/usr/bin/env bash
# Close a GitLab issue. GitLab records no reason for a close, so only
# `completed` is accepted: a reason that would not be recorded is refused,
# never dropped. It checks no gate: the executor runs cascade-check.sh first,
# and moves the card to Done after.
#
# Usage: close.sh <number> [completed]
# Exit: 0 closed · 2 usage, or a reason GitLab cannot record · other glab's
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

[ "$#" -ge 1 ] && [ "$#" -le 2 ] || { echo 'usage: close.sh <number> [completed]' >&2; exit 2; }
NUM=$(require_issue_number "$1") || exit 2
[ "${2:-completed}" = completed ] || { echo "close.sh: GitLab records no close reason; only 'completed'" >&2; exit 2; }

glab issue close "$NUM" --repo "$PROJECT_ID" >/dev/null
echo "closed #$NUM"
