#!/usr/bin/env bash
# Resolve a task's parent epic, if it has one. Local-backend twin.
#
# Usage:   parent-of.sh <task-number>
# Stdout:  the parent's number, on exit 0. Nothing otherwise.
# Exit:    0  it is a sub-task — the parent's number is on stdout
#          10 it has no parent, and that is not an error
#          3  the task does not exist
#          2  usage error
#
# Exit 10 is its own code so a caller can tell "no parent" from "could not
# ask". Collapsing them makes a standalone task and a failed lookup
# indistinguishable, and the caller branches the same way on each.
#
# The link is the `parent: "#NNN"` frontmatter `add.sh --parent` already
# writes and `propagate-parent-status.sh` already reads. Nothing new is
# invented here; the convention existed in fragments and is collected.
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 1 ]; then
  echo 'usage: parent-of.sh <task-number>' >&2
  exit 2
fi
NUM="$1"
case "$NUM" in
  '' | *[!0-9]*) echo "not a task number: '$NUM'" >&2; exit 2 ;;
esac

# `10#` forces base 10. Without it `printf '%03d' 011` reads the argument
# as OCTAL and yields 009 — a lookup for a different task, silently. A
# caller that pads its own numbers would get the wrong file and never know.
PADDED=$(printf '%03d' "$((10#$NUM))")
FILE=""
for candidate in "$BACKLOG_DIR/$PADDED"-*.md; do
  [ -e "$candidate" ] || continue
  FILE="$candidate"
  break
done

if [ -z "$FILE" ]; then
  echo "✗ task #$NUM not found under $BACKLOG_DIR" >&2
  exit 3
fi

# Frontmatter only — the first `---` block. A `parent:` written in the body
# is prose, and reading it would attach a task to an epic somebody merely
# mentioned.
PARENT=$(awk '
  NR == 1 && /^---[[:space:]]*$/ { inside = 1; next }
  inside && /^---[[:space:]]*$/  { exit }
  inside && /^parent:/ {
    sub(/^parent:[[:space:]]*/, "")
    gsub(/^["'\''#]+|["'\'']+$/, "")
    print
    exit
  }
' "$FILE")

case "$PARENT" in
  '' | null | ~ ) exit 10 ;;
  *[!0-9]* )
    echo "✗ task #$NUM has a parent: value this script cannot read: $PARENT" >&2
    exit 3
    ;;
esac

echo "$PARENT"
exit 0
