#!/usr/bin/env bash
# Move a backlog item to a new status. Updates the file's frontmatter and
# regenerates the column-organised index.
# Usage: move.sh <number> <Status> [--not-planned]
#
# `/task close <id> --not-planned` is `move.sh <id> Done --not-planned`: the
# item is Done with `resolution: not-planned` beside its status. Every other
# move drops that line, so a reopened or re-closed item never keeps it.
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo 'usage: move.sh <number> <Status> [--not-planned]' >&2
  echo '  Status one of: Backlog, Ready, "In progress", "In review", Done' >&2
  exit 2
fi
NUM=$(printf "%03d" "$1" 2>/dev/null || echo "$1")
STATUS="$2"
RESOLUTION=""

case "$STATUS" in
  Backlog|Ready|"In progress"|"In review"|Done) ;;
  *)
    echo "unknown status '$STATUS' — expected: Backlog, Ready, 'In progress', 'In review', Done" >&2
    exit 2
    ;;
esac
if [ "$#" -eq 3 ]; then
  if [ "$3" != "--not-planned" ] || [ "$STATUS" != Done ]; then
    echo "unexpected '$3' — the only flag is --not-planned, and only with Done" >&2
    exit 2
  fi
  RESOLUTION=not-planned
fi

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BACKLOG_DIR="$ROOT/.specnaut/backlog"
RENDER="$(dirname "$0")/render-index.sh"

shopt -s nullglob
matches=("$BACKLOG_DIR/$NUM-"*.md)
if [ "${#matches[@]}" -eq 0 ]; then
  echo "no backlog item #$NUM" >&2
  exit 1
fi
FILE="${matches[0]}"

# Update frontmatter status (between the first two `---` lines). Under
# `set -e` an `awk … && mv` that fails exits nothing: the old form left the
# temp file and printed ✓ over an item it never moved.
if ! awk -v new="$STATUS" -v res="$RESOLUTION" '
  BEGIN {n=0}
  /^---$/ {n++; print; next}
  n==1 && /^resolution:/ {next}
  n==1 && /^status:/ {print "status: " new; if (res != "") print "resolution: " res; updated=1; next}
  {print}
  END {if (!updated) exit 3}
' "$FILE" > "$FILE.tmp"; then
  rm -f "$FILE.tmp"
  echo "#$NUM has no status: line in its frontmatter — nothing moved" >&2
  exit 1
fi
mv "$FILE.tmp" "$FILE"

# Regenerate the column-organised index from the file tree.
bash "$RENDER" "$ROOT"

echo "✓ #$NUM → $STATUS${RESOLUTION:+ ($RESOLUTION)}"

# Post-move hook: promote the parent Epic if this was a sub-task
# leaving Backlog. Best-effort — never blocks on failure. See
# propagate-parent-status.sh for the full state machine.
PROPAGATE="$(dirname "$0")/propagate-parent-status.sh"
if [ -x "$PROPAGATE" ]; then
  "$PROPAGATE" "$NUM" "$STATUS" || true
fi
