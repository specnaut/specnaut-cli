#!/usr/bin/env bash
# Show one Specnaut Cloud task: its creation time on the first line, ahead of any
# task text, then status, priority, size and body.
# Usage: view.sh <number>
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <number>" >&2
  exit 2
fi
NUM="$1"
COLS=$(cloud_curl "$API_BASE/columns?projectKey=$PROJECT_KEY")
RESP=$(cloud_curl "$API_BASE/tasks?projectKey=$PROJECT_KEY&number=$NUM")

# The one shape on every backend: UTC, seconds, `Z`. It comes from the API's answer
# and is never computed here. Anything else, a missing field included, prints `—`:
# a phase turns this value into a command argument, so only this shape may reach it.
CREATED=$(printf '%s' "$RESP" | jq_lf -r '.task.createdAt | if type == "string" then . else "" end')
if (LC_ALL=C; [[ $CREATED =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$ ]]); then
  CREATED="${CREATED%Z}"
  CREATED="${CREATED%%.*}Z"
else
  CREATED="—"
fi
printf 'created:\t%s\n' "$CREATED"

echo "$RESP" | jq_lf -r --argjson cols "$COLS" '
  ($cols.columns | map({ (.id): .name }) | add) as $names
  | .task
  | "#\(.number)  \(.title)",
    "status:   \($names[.columnId] // "—")",
    "priority: \(.priority // "—")    size: \(.size // "—")",
    "",
    (.body // "(no description)")
'
