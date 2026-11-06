#!/usr/bin/env bash
# Add labels to a GitHub issue. Labels the repository already has: gh refuses
# one it does not know, and this script creates none.
#
# Usage: label.sh <number> <label>...
# Exit: 0 labelled · 2 usage · other gh's
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

[ "$#" -ge 2 ] || { echo 'usage: label.sh <number> <label>...' >&2; exit 2; }
NUM=$(require_issue_number "$1") || exit 2
shift
ARGS=(issue edit "$NUM" --repo "$REPO")
for l in "$@"; do
  case "$l" in '' | *,*) echo "label.sh: a label is one name, without a comma" >&2; exit 2 ;; esac
  ARGS+=(--add-label "$l")
done

gh "${ARGS[@]}" >/dev/null
echo "labelled #$NUM"
