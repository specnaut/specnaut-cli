#!/usr/bin/env bash
# Resolve an issue's parent epic, if it has one. GitLab twin of the github
# script — same contract, different link.
#
# Usage:   parent-of.sh <issue-number>
# Stdout:  the parent's issue number, on exit 0. Nothing otherwise.
# Exit:    0  it is a child — the parent's number is on stdout
#          10 it is not a child — no parent, and that is not an error
#          3  the issue does not exist, or the lookup failed
#          2  usage error
#
# Exit 10 is its own code so a caller can tell "no parent" from "could not
# ask". Collapsing the two makes a standalone item and a failed lookup
# indistinguishable, and the caller branches the same way on each.
#
# GitLab has no native sub-issue link at this level, so the parent is the
# scoped label `parent::#NNN` — the same convention `cascade-check.sh` reads
# from the other end, and the one `add.sh --parent` writes.
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 1 ]; then
  echo 'usage: parent-of.sh <issue-number>' >&2
  exit 2
fi
NUM="$1"
case "$NUM" in
  '' | *[!0-9]*) echo "not an issue number: '$NUM'" >&2; exit 2 ;;
esac

# Branch on glab's EXIT STATUS, not on empty output: a failed lookup that
# happens to print something would otherwise read as "no parent". Under
# `set -e` the `|| rc=$?` form is required — a failing command substitution
# inside an assignment aborts before the next line runs.
api_rc=0
PAYLOAD=$(glab issue view "$NUM" --repo "$PROJECT_ID" --output json 2>/dev/null) || api_rc=$?
if [ "$api_rc" -ne 0 ] || [ -z "$PAYLOAD" ]; then
  echo "✗ issue #$NUM not found in $PROJECT_ID" >&2
  exit 3
fi

PARENT_NUM=$(printf '%s' "$PAYLOAD" \
  | jq -r '[.labels[]? | select(startswith("parent::#"))] | first // empty' \
  | sed 's/^parent::#//')

if [ -z "$PARENT_NUM" ]; then
  exit 10
fi

case "$PARENT_NUM" in
  *[!0-9]*)
    echo "✗ #$NUM carries a parent:: label this script cannot read: $PARENT_NUM" >&2
    exit 3
    ;;
esac

echo "$PARENT_NUM"
exit 0
