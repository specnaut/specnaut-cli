#!/usr/bin/env bash
# Move a backlog item to a new status. Updates the file's frontmatter and
# regenerates the column-organised index.
# Usage: move.sh <number> <Status>
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo 'usage: move.sh <number> <Status>' >&2
  echo '  Status one of: Backlog, Ready, "In progress", "In review", Done' >&2
  exit 2
fi
NUM=$(printf "%03d" "$1" 2>/dev/null || echo "$1")
STATUS="$2"

case "$STATUS" in
  Backlog|Ready|"In progress"|"In review"|Done) ;;
  *)
    echo "unknown status '$STATUS' — expected: Backlog, Ready, 'In progress', 'In review', Done" >&2
    exit 2
    ;;
esac

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BACKLOG_DIR="$ROOT/.specflow/backlog"
RENDER="$(dirname "$0")/render-index.sh"

shopt -s nullglob
matches=("$BACKLOG_DIR/$NUM-"*.md)
if [ "${#matches[@]}" -eq 0 ]; then
  echo "no backlog item #$NUM" >&2
  exit 1
fi
FILE="${matches[0]}"

# Update frontmatter status (between the first two `---` lines)
awk -v new="$STATUS" '
  BEGIN {n=0}
  /^---$/ {n++; print; next}
  n==1 && /^status:/ {print "status: " new; updated=1; next}
  {print}
  END {if (!updated) exit 3}
' "$FILE" > "$FILE.tmp" && mv "$FILE.tmp" "$FILE"

# Regenerate the column-organised index from the file tree.
bash "$RENDER" "$ROOT"

echo "✓ #$NUM → $STATUS"
