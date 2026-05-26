#!/usr/bin/env bash
# Create a new issue on one of the mkrlabs/specflow* repos and attach it to
# Project #4 (Backlog). Defaults to `mkrlabs/specflow`.
# Usage:
#   add.sh [--repo <short>] "<title>"
#   add.sh [--repo <short>] "<title>" "<body>"
#   add.sh [--repo <short>] "<title>" "<body>" "<label1,label2,...>"
#   <short> ∈ specflow | specflow-cloud | specflow-monorepo
set -euo pipefail

# Guard --help / unknown flags before they reach `gh issue create` as a
# positional title (#333) — otherwise `add.sh --help` creates a junk issue.
case "${1:-}" in
  -h | --help)
    echo 'usage: add.sh [--repo <short>] "<title>" [<body>] [<labels-csv>]'
    exit 0
    ;;
esac

. "$(dirname "$0")/_repo.sh"
resolve_repo "$@"
set -- ${REPO_REMAINING_ARGS[@]+"${REPO_REMAINING_ARGS[@]}"}

# After --repo extraction, the next token must be the title (or a valid flag
# we still want to reject explicitly).
case "${1:-}" in
  --*)
    echo "add.sh: unknown flag '$1'" >&2
    exit 2
    ;;
esac

TITLE="${1:?usage: add.sh [--repo <short>] \"<title>\" [<body>] [<labels-csv>]}"
BODY="${2:-}"
LABELS="${3:-}"

ARGS=(--repo "$REPO" --title "$TITLE")
[[ -n "$BODY" ]] && ARGS+=(--body "$BODY")
[[ -n "$LABELS" ]] && ARGS+=(--label "$LABELS")

URL=$(gh issue create "${ARGS[@]}" 2>&1 | tail -1)
gh project item-add 4 --owner mkrlabs --url "$URL" >/dev/null

echo "$URL"
