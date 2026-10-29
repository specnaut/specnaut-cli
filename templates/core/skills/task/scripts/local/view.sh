#!/usr/bin/env bash
# Print one backlog item by number.
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <number>" >&2
  exit 2
fi
NUM=$(printf "%03d" "$1" 2>/dev/null || echo "$1")
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BACKLOG_DIR="$ROOT/.specnaut/backlog"

shopt -s nullglob
matches=("$BACKLOG_DIR/$NUM-"*.md)
if [ "${#matches[@]}" -eq 0 ]; then
  echo "no backlog item #$NUM" >&2
  exit 1
fi
cat "${matches[0]}"
