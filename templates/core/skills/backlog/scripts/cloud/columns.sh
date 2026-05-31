#!/usr/bin/env bash
# Print the board's column layout (order + name) — the live stage list the
# product-owner reasons about on the Cloud backend. Names come straight from
# the board, so a renamed/reordered column is reflected with no code change.
#
# Usage: columns.sh
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

AUTH=(-H "Authorization: Bearer $API_TOKEN")
RESP=$(curl -fsS "$API_BASE/columns?projectKey=$PROJECT_KEY" "${AUTH[@]}")

echo "$RESP" | jq -r '.columns | sort_by(.order)[] | "  \(.order)\t\(.name)"'
