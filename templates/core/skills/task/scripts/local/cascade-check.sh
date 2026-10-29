#!/usr/bin/env bash
# Verify that a parent task is safe to close — every sub-task must already
# be done. Local-backend twin of the github script, same exit contract so
# callers need no per-backend branching.
#
# Usage:   cascade-check.sh <task-number>
# Exit:    0  no open children — safe to close
#          11 at least one child is still open — close blocked
#          12 the parent is already done — nothing to gate
#          3  the parent does not exist
#          2  usage error
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 1 ]; then
  echo 'usage: cascade-check.sh <task-number>' >&2
  exit 2
fi
NUM="$1"
case "$NUM" in
  '' | *[!0-9]*) echo "not a task number: '$NUM'" >&2; exit 2 ;;
esac

# Read one frontmatter scalar from a task file.
_fm() {
  awk -v key="$2" '
    NR == 1 && /^---[[:space:]]*$/ { inside = 1; next }
    inside && /^---[[:space:]]*$/  { exit }
    inside && $0 ~ "^"key":" {
      sub("^"key":[[:space:]]*", "")
      gsub(/^["'\''#]+|["'\'']+$/, "")
      print
      exit
    }
  ' "$1"
}

# `10#` forces base 10. Without it `printf '%03d' 011` reads the argument
# as OCTAL and yields 009 — a lookup for a different task, silently. A
# caller that pads its own numbers would get the wrong file and never know.
PADDED=$(printf '%03d' "$((10#$NUM))")
PARENT_FILE=""
for candidate in "$BACKLOG_DIR/$PADDED"-*.md; do
  [ -e "$candidate" ] || continue
  PARENT_FILE="$candidate"
  break
done
if [ -z "$PARENT_FILE" ]; then
  echo "✗ task #$NUM not found under $BACKLOG_DIR" >&2
  exit 3
fi

# Already-done short-circuit, matching github's exit 12: a caller that
# trusts exit 0 would otherwise close it a second time.
PARENT_STATUS=$(_fm "$PARENT_FILE" status)
if [ "$PARENT_STATUS" = "done" ]; then
  echo "ℹ #$NUM is already done — nothing to gate"
  exit 12
fi

# A child is open when its status is anything but done or deferred. Both are
# terminal here: `deferred` is a decision not to do the work, and holding a
# parent open on one would block the epic on a task nobody intends to finish.
OPEN=0
TOTAL=0
OPEN_LIST=""
for f in "$BACKLOG_DIR"/*.md; do
  [ -e "$f" ] || continue
  [ "$f" = "$PARENT_FILE" ] && continue
  [ "$(_fm "$f" parent)" = "$NUM" ] || continue
  TOTAL=$((TOTAL + 1))
  st=$(_fm "$f" status)
  case "$st" in
    done | deferred) continue ;;
  esac
  OPEN=$((OPEN + 1))
  OPEN_LIST="$OPEN_LIST  - #$(_fm "$f" id) — $(_fm "$f" title) [${st:-no status}]
"
done

if [ "$OPEN" -gt 0 ]; then
  echo "✗ #$NUM has $OPEN open child task(s) of $TOTAL — close them first"
  printf '%s' "$OPEN_LIST"
  exit 11
fi

# "No child is linked at all" and "every child is terminal" are different
# facts. Both are safe to close. This backend reads the filesystem, so it has
# neither the unread-page nor the fails-open defect its API siblings carried —
# this is the only change it needs.
if [ "$TOTAL" -eq 0 ]; then
  echo "✓ #$NUM has no linked children — no cascade applies"
else
  echo "✓ #$NUM safe to close — all $TOTAL child task(s) are done or deferred"
fi
exit 0
