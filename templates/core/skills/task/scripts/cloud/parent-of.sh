#!/usr/bin/env bash
# Resolve a task's parent epic, if it has one. Cloud-backend twin.
#
# Usage:   parent-of.sh <task-number>
# Stdout:  the parent's number, on exit 0. Nothing otherwise.
# Exit:    0  it is a sub-task — the parent's number is on stdout
#          10 it has no parent, and that is not an error
#          3  the task does not exist, or the lookup failed
#          2  usage error
#
# Exit 10 is its own code so a caller can tell "no parent" from "could not
# ask". Collapsing them makes a standalone task and a failed lookup
# indistinguishable, and the caller branches the same way on each.
#
# Uses the versioned public HTTP contract only, by task NUMBER. No internal
# identifier of the hosted board appears here or ever should.
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

AUTH=(-H "Authorization: Bearer $API_TOKEN")

# Branch on curl's EXIT STATUS, not on empty output: an error body is still
# output, and treating it as "no parent" is the one confusion this script
# exists to prevent. `|| rc=$?` because under `set -e` a failing command
# substitution in an assignment aborts before the next line runs.
rc=0
RESP=$(curl -fsS "$API_BASE/tasks?projectKey=$PROJECT_KEY&number=$NUM" "${AUTH[@]}") || rc=$?
if [ "$rc" -ne 0 ] || [ -z "$RESP" ]; then
  echo "✗ task #$NUM not found on the board (or the lookup failed)" >&2
  exit 3
fi

PARENT=$(printf '%s' "$RESP" | jq -r '.task.parentNumber // empty')
[ -n "$PARENT" ] || exit 10

case "$PARENT" in
  *[!0-9]*)
    echo "✗ task #$NUM has a parentNumber this script cannot read: $PARENT" >&2
    exit 3
    ;;
esac

echo "$PARENT"
exit 0
