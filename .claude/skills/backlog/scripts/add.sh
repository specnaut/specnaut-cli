#!/usr/bin/env bash
# Create a new issue on mkrlabs/specflow and attach it to Project #4 (Backlog).
# Usage:
#   add.sh "<title>"
#   add.sh "<title>" "<body>"
#   add.sh "<title>" "<body>" "<label1,label2,...>"
set -euo pipefail

# Guard --help / unknown flags before they reach `gh issue create` as a
# positional title (#333) — otherwise `add.sh --help` creates a junk issue.
case "${1:-}" in
  -h|--help)
    echo 'usage: add.sh "<title>" [<body>] [<labels-csv>]'
    exit 0
    ;;
  --*)
    echo "add.sh: unknown flag '$1'" >&2
    exit 2
    ;;
esac

TITLE="${1:?usage: add.sh \"<title>\" [<body>] [<labels-csv>]}"
BODY="${2:-}"
LABELS="${3:-}"

ARGS=(--repo mkrlabs/specflow --title "$TITLE")
[[ -n "$BODY" ]]   && ARGS+=(--body "$BODY")
[[ -n "$LABELS" ]] && ARGS+=(--label "$LABELS")

URL=$(gh issue create "${ARGS[@]}" 2>&1 | tail -1)
gh project item-add 4 --owner mkrlabs --url "$URL" >/dev/null

echo "$URL"
