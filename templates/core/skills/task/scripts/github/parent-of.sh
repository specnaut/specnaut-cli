#!/usr/bin/env bash
# Resolve an issue's parent epic, if it has one.
#
# Usage:   parent-of.sh <issue-number>
# Stdout:  the parent's issue number, on exit 0. Nothing otherwise.
# Exit:    0  it is a sub-issue — the parent's number is on stdout
#          10 it is not a sub-issue — no parent, and that is not an error
#          3  the issue does not exist
#          2  usage error
#
# Exit 10 mirrors set-field.sh: a capability that legitimately does not apply
# is its own code, so a caller can tell "no parent" from "could not ask". A
# script that printed nothing and exited 0 for both would make a standalone
# item and a failed lookup indistinguishable, and the caller would branch the
# same way on each.
#
# The parent link is the native sub-issues one. GitHub exposes it on the CHILD
# as `parent_issue_url` — not `parent`, which does not exist on this payload.
# One REST call, no GraphQL.
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

# Existence and the parent link in one call.
#
# Branch on gh's EXIT STATUS, not on whether stdout is empty. On a 404 `gh api`
# writes its error JSON to stdout — `{"message":"Not Found",…}` — so an
# emptiness test sees a payload, finds no `parent_issue_url` in it, and reports
# a missing issue as "no parent". That is precisely the conflation the exit-10
# contract above exists to prevent, and the first draft of this script shipped
# it: #99999999 returned 10 instead of 3. Caught by exercising the failure path
# against the live board rather than only the happy one.
#
# `|| api_rc=$?` and not `PAYLOAD=$(…); api_rc=$?` — under `set -e` a failing
# command substitution in an assignment aborts before the next line runs.
api_rc=0
PAYLOAD=$(gh api "repos/$REPO_OWNER/$REPO_NAME/issues/$NUM" 2>/dev/null) || api_rc=$?
if [ "$api_rc" -ne 0 ] || [ -z "$PAYLOAD" ]; then
  echo "✗ issue #$NUM not found in $REPO_OWNER/$REPO_NAME" >&2
  exit 3
fi

PARENT_URL=$(printf '%s' "$PAYLOAD" | jq -r '.parent_issue_url // empty')
if [ -z "$PARENT_URL" ]; then
  exit 10
fi

# .../issues/<n> — take the trailing path segment.
PARENT_NUM="${PARENT_URL##*/}"
case "$PARENT_NUM" in
  '' | *[!0-9]*)
    echo "✗ #$NUM has a parent link this script cannot read: $PARENT_URL" >&2
    exit 3
    ;;
esac

echo "$PARENT_NUM"
exit 0
