#!/usr/bin/env bash
# Add labels to a GitLab issue. GitLab creates a label it does not know, from
# its name: each one passes the secret check a text does.
#
# Usage: label.sh <number> <label>...
# Exit: 0 labelled · 2 usage · 14 a text its secret check refused
# (require_clean_text, _backlog_plan.sh), nothing sent ·
# other glab's
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"
# shellcheck source=../_backlog_plan.sh
. "$(dirname "$0")/_backlog_plan.sh"

[ "$#" -ge 2 ] || { echo 'usage: label.sh <number> <label>...' >&2; exit 2; }
NUM=$(require_issue_number "$1") || exit 2
shift
LABELS=""
for l in "$@"; do
  case "$l" in '' | *,*) echo "label.sh: a label is one name, without a comma" >&2; exit 2 ;; esac
  require_clean_text label "$l"
  LABELS="${LABELS:+$LABELS,}$l"
done

glab issue update "$NUM" --repo "$PROJECT_ID" --label "$LABELS" >/dev/null
echo "labelled #$NUM"
