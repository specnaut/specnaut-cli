#!/usr/bin/env bash
# Print the board's column layout (order + name) — the live stage list the
# product-owner reasons about on the Cloud backend. Names come straight from
# the board, so a renamed/reordered column is reflected with no code change.
#
# --terminal prints only the terminal column's name (`terminal_column`,
# _config.sh): the column a close moves a task to. Exit 3 when the board has
# none.
#
# Usage: columns.sh [--terminal]
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

RESP=$(cloud_curl "$API_BASE/columns?projectKey=$PROJECT_KEY")
if [ "${1:-}" = --terminal ]; then
  terminal_column "$RESP" || { echo "columns.sh: the board reports no columns" >&2; exit 3; }
  printf '%s\n' "$TERMINAL_NAME"
  exit 0
fi

echo "$RESP" | jq_lf -r '.columns | sort_by(.order)[] | "  \(.order)\t\(.name)"'
