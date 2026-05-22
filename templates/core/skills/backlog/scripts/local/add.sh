#!/usr/bin/env bash
# Add a new backlog item. Auto-numbers + slugifies. Status starts at "Backlog".
# Optional `--parent <num>` flag turns the new item into a sub-task of an
# existing parent (writes `parent: "#NNN"` into frontmatter and cross-links
# the parent file under a `## Sub-tasks` section).
#
# Usage:
#   add.sh "<title>" [body] [labels-csv] [--parent <num>]
set -euo pipefail

PARENT=""
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      echo 'usage: add.sh "<title>" [body] [labels] [--parent <num>]'
      exit 0
      ;;
    --parent)
      if [ $# -lt 2 ]; then
        echo 'usage: add.sh "<title>" [body] [labels] [--parent <num>]' >&2
        exit 2
      fi
      PARENT="$2"
      shift 2
      ;;
    --*)
      echo "add.sh: unknown flag '$1'" >&2
      echo 'usage: add.sh "<title>" [body] [labels] [--parent <num>]' >&2
      exit 2
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

if [ "${#ARGS[@]}" -lt 1 ]; then
  echo 'usage: add.sh "<title>" [body] [labels] [--parent <num>]' >&2
  exit 2
fi
TITLE="${ARGS[0]}"
BODY="${ARGS[1]:-}"

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BACKLOG_DIR="$ROOT/.specflow/backlog"
INDEX="$ROOT/.specflow/backlog.md"
RENDER="$(dirname "$0")/render-index.sh"
mkdir -p "$BACKLOG_DIR"

# When --parent is set, refuse to create a child of a non-existent parent.
PARENT_FILE=""
PARENT_PADDED=""
if [ -n "$PARENT" ]; then
  PARENT_PADDED=$(printf "%03d" "$PARENT")
  shopt -s nullglob
  for candidate in "$BACKLOG_DIR/$PARENT_PADDED"-*.md; do
    PARENT_FILE="$candidate"
    break
  done
  if [ -z "$PARENT_FILE" ]; then
    echo "✗ parent #$PARENT_PADDED not found in $BACKLOG_DIR" >&2
    exit 3
  fi
fi

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

if [ -n "$PARENT" ]; then
  cat > "$FILE" <<EOF
---
number: $NEXT
title: $TITLE
status: Backlog
size:
priority:
parent: "#$PARENT_PADDED"
created: $NOW
---

$BODY
EOF
  # Append a cross-link to the parent file under a `## Sub-tasks` section.
  if ! grep -q "^## Sub-tasks$" "$PARENT_FILE"; then
    printf '\n## Sub-tasks\n\n' >> "$PARENT_FILE"
  fi
  printf -- '- #%s — %s\n' "$NEXT" "$TITLE" >> "$PARENT_FILE"
else
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
fi

# Regenerate the column-organised index from the file tree.
bash "$RENDER" "$ROOT"

echo "✓ created #$NEXT — $TITLE"
echo "  $FILE"
if [ -n "$PARENT" ]; then
  echo "  ↳ child of #$PARENT_PADDED — $PARENT_FILE"
fi
