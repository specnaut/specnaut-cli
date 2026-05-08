#!/usr/bin/env bash
# Regenerate .specflow/backlog.md from the per-item files in
# .specflow/backlog/. Items are grouped by their `status:` frontmatter
# field into the 5 standard columns.
# Usage: render-index.sh [<project-root>]
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/../../.." && pwd)}"
BACKLOG_DIR="$ROOT/.specflow/backlog"
INDEX="$ROOT/.specflow/backlog.md"

# Collect (status \t line) pairs by reading each item's frontmatter.
# Sort by item number within each status by relying on filename order.
LINES_BACKLOG=""
LINES_READY=""
LINES_INPROG=""
LINES_INREV=""
LINES_DONE=""

shopt -s nullglob
for f in $(printf "%s\n" "$BACKLOG_DIR"/*.md | sort); do
  base=$(basename "$f")
  num=$(echo "$base" | cut -d- -f1)
  title=$(awk '/^---$/{n++; next} n==1 && /^title:/ {sub(/^title:[[:space:]]*/, ""); print; exit}' "$f")
  status=$(awk '/^---$/{n++; next} n==1 && /^status:/ {sub(/^status:[[:space:]]*/, ""); print; exit}' "$f")
  size=$(awk '/^---$/{n++; next} n==1 && /^size:/ {sub(/^size:[[:space:]]*/, ""); print; exit}' "$f")
  priority=$(awk '/^---$/{n++; next} n==1 && /^priority:/ {sub(/^priority:[[:space:]]*/, ""); print; exit}' "$f")

  badge=""
  [ -n "$size" ] && badge="$badge \`size:$size\`"
  [ -n "$priority" ] && badge="$badge \`priority:$priority\`"
  line="- [#$num](backlog/$base)$badge — $title"

  case "$status" in
    Backlog)        LINES_BACKLOG="$LINES_BACKLOG$line"$'\n' ;;
    Ready)          LINES_READY="$LINES_READY$line"$'\n' ;;
    "In progress")  LINES_INPROG="$LINES_INPROG$line"$'\n' ;;
    "In review")    LINES_INREV="$LINES_INREV$line"$'\n' ;;
    Done)           LINES_DONE="$LINES_DONE$line"$'\n' ;;
    *)              LINES_BACKLOG="$LINES_BACKLOG$line  <!-- unknown status: $status -->"$'\n' ;;
  esac
done

emit_section() {
  local header="$1"
  local lines="$2"
  echo "## $header"
  echo
  if [ -z "$lines" ]; then
    echo "_No tasks yet._"
  else
    printf "%s" "$lines"
  fi
  echo
}

{
  cat <<'HEADER'
# Backlog

> Managed by the Product Owner agent (`/backlog`). Each task is one
> file under `.specflow/backlog/NNN-slug.md` with frontmatter; this
> index lists items grouped by status column.

The 5 status columns mirror the GitHub Projects "kanban" model:

- **Backlog** — needs more info, sizing, or prioritisation. The PO
  works these on `/specflow groom` until they're ready.
- **Ready** — clarified, sized, prioritised. The PO proposes these
  for development when asked "what's next".
- **In progress** — actively being worked on (a branch is open).
- **In review** — implementation done, PR open, awaiting merge.
- **Done** — closed / shipped (kept here for the recent audit trail;
  prune as needed).

Size and priority live in each item's frontmatter (see
`.specflow/backlog/NNN-*.md`):

```yaml
---
number: NNN
title: ...
status: Backlog | Ready | "In progress" | "In review" | Done
size: XS | S | M | L | XL
priority: P0 | P1 | P2 | P3
created: ...
---
```

The PO assigns size + priority during the `/specflow groom` pass.

---

HEADER
  emit_section "Backlog" "$LINES_BACKLOG"
  emit_section "Ready" "$LINES_READY"
  emit_section "In progress" "$LINES_INPROG"
  emit_section "In review" "$LINES_INREV"
  emit_section "Done" "$LINES_DONE"
} > "$INDEX"
