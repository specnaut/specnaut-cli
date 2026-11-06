#!/usr/bin/env bash
# List backlog items from .specnaut/backlog/. Optional Status filter.
# Usage: list.sh [--numbers] [Status]
#   --numbers  one item number per line, zero padding dropped, and nothing else
#              (`read-items.sh`); a file whose name starts with no number is skipped
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BACKLOG_DIR="$ROOT/.specnaut/backlog"
NUMBERS=false
if [ "${1:-}" = "--numbers" ]; then NUMBERS=true; shift; fi
FILTER="${1:-}"

if [ ! -d "$BACKLOG_DIR" ]; then
  [ "$NUMBERS" = false ] || exit 0
  echo "(no backlog yet — run 'add.sh' to create the first item)"
  exit 0
fi

shopt -s nullglob
for f in "$BACKLOG_DIR"/*.md; do
  status=$(awk '/^---$/{n++; next} n==1 && /^status:/ {sub(/^status:[[:space:]]*/, ""); print; exit}' "$f")
  title=$(awk '/^---$/{n++; next} n==1 && /^title:/ {sub(/^title:[[:space:]]*/, ""); print; exit}' "$f")
  num=$(basename "$f" | cut -d- -f1)
  if [ -n "$FILTER" ] && [ "$status" != "$FILTER" ]; then continue; fi
  if [ "$NUMBERS" = false ]; then
    printf "  #%-4s  %-12s  %s\n" "$num" "$status" "$title"
  elif [[ $num =~ ^[0-9]{1,10}$ ]] && [ "$((10#$num))" -gt 0 ]; then
    echo "$((10#$num))"
  fi
done
