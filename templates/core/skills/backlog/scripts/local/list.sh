#!/usr/bin/env bash
# List backlog items from .specnaut/backlog/. Optional Status filter.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BACKLOG_DIR="$ROOT/.specnaut/backlog"
FILTER="${1:-}"

if [ ! -d "$BACKLOG_DIR" ]; then
  echo "(no backlog yet — run 'add.sh' to create the first item)"
  exit 0
fi

shopt -s nullglob
for f in "$BACKLOG_DIR"/*.md; do
  status=$(awk '/^---$/{n++; next} n==1 && /^status:/ {sub(/^status:[[:space:]]*/, ""); print; exit}' "$f")
  title=$(awk '/^---$/{n++; next} n==1 && /^title:/ {sub(/^title:[[:space:]]*/, ""); print; exit}' "$f")
  num=$(basename "$f" | cut -d- -f1)
  if [ -z "$FILTER" ] || [ "$status" = "$FILTER" ]; then
    printf "  #%-4s  %-12s  %s\n" "$num" "$status" "$title"
  fi
done
