#!/usr/bin/env bash
# Append a clarification block to a backlog item file.
# Usage: clarify-comment.sh <number> "<question>"
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo 'usage: clarify-comment.sh <number> "<question>"' >&2
  exit 2
fi
NUM=$(printf "%03d" "$1" 2>/dev/null || echo "$1")
QUESTION="$2"

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BACKLOG_DIR="$ROOT/.specnaut/backlog"

shopt -s nullglob
matches=("$BACKLOG_DIR/$NUM-"*.md)
if [ "${#matches[@]}" -eq 0 ]; then
  echo "no backlog item #$NUM" >&2
  exit 1
fi
FILE="${matches[0]}"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

cat >> "$FILE" <<EOF

## Clarification ($NOW)

$QUESTION
EOF

echo "✓ added clarification on #$NUM"
