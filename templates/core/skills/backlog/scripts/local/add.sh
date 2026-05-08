#!/usr/bin/env bash
# Add a new backlog item. Auto-numbers + slugifies. Status starts at "Backlog".
# Usage: add.sh "<title>" [body]
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo 'usage: add.sh "<title>" [body]' >&2
  exit 2
fi
TITLE="$1"
BODY="${2:-}"

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BACKLOG_DIR="$ROOT/.specflow/backlog"
INDEX="$ROOT/.specflow/backlog.md"
RENDER="$(dirname "$0")/render-index.sh"
mkdir -p "$BACKLOG_DIR"

# Next free number
shopt -s nullglob
HIGH=0
for f in "$BACKLOG_DIR"/*.md; do
  n=$(basename "$f" | cut -d- -f1 | sed 's/^0*//')
  [ -z "$n" ] && n=0
  if [ "$n" -gt "$HIGH" ]; then HIGH=$n; fi
done
NEXT=$(printf "%03d" $((HIGH + 1)))

# Slug from title — lowercase, hyphenate, drop punctuation, cap to 40 chars
SLUG=$(echo "$TITLE" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-40)
[ -z "$SLUG" ] && SLUG="item"

FILE="$BACKLOG_DIR/$NEXT-$SLUG.md"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

cat > "$FILE" <<EOF
---
number: $NEXT
title: $TITLE
status: Backlog
size:
priority:
created: $NOW
---

$BODY
EOF

# Regenerate the column-organised index from the file tree.
bash "$RENDER" "$ROOT"

echo "✓ created #$NEXT — $TITLE"
echo "  $FILE"
