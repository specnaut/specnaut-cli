#!/usr/bin/env bash
# Add labels to a GitLab issue.
#
# Usage: label.sh <number> <label>...
# Exit: 0 labelled · 2 usage · other glab's
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

[ "$#" -ge 2 ] || { echo 'usage: label.sh <number> <label>...' >&2; exit 2; }
NUM=$(require_issue_number "$1") || exit 2
shift
LABELS=""
for l in "$@"; do
  case "$l" in '' | *,*) echo "label.sh: a label is one name, without a comma" >&2; exit 2 ;; esac
  LABELS="${LABELS:+$LABELS,}$l"
done

glab issue update "$NUM" --repo "$PROJECT_ID" --label "$LABELS" >/dev/null
echo "labelled #$NUM"
