#!/usr/bin/env bash
# Verify that a parent issue is safe to close — every child tagged with
# the `parent::#NNN` scoped label must already be closed. Refuses (exit
# 11) otherwise so the PO can surface the open children and finish them
# first.
#
# Usage:   cascade-check.sh <issue-number>
# Exit:    0  parent has no open children — safe to close
#          11 at least one child is still open — close blocked
#          12 parent is already closed — nothing to gate (short-circuit)
#          3  the parent could not be read, OR its children could not be read
#          2  usage error — no argument, or an argument that is not a number
#
# EVERY non-zero exit means "do not close". Exit 3 covers a failed
# enumeration: this script answers a safety question, and a question it could
# not answer must never read as a yes. It does NOT cover being called wrong —
# a misuse is the caller's bug, not the world being unreadable, and the two
# used to be indistinguishable.
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 1 ]; then
  echo 'usage: cascade-check.sh <issue-number>' >&2
  exit 2
fi
NUM="$1"
# A bad ARGUMENT is a usage error, and it used to reach the API as if it were
# an issue number — where the failed lookup rendered it as exit 3, the code
# that tells a caller the world was unreadable. Misuse and unreadability are
# not the same event and must not share a code.
case "$NUM" in
  '' | *[!0-9]*) echo "not an issue number: '$NUM'" >&2; exit 2 ;;
esac

# Existence + state in one glab call, judged by its EXIT CODE. Mirrors the
# GitHub backend so both variants share the exit-code contract (3 = unreadable,
# 12 = already closed, 11 = open children, 0 = safe). GitLab issue states are
# `opened`/`closed`.
#
# The previous shape ended `| jq -r '.state // empty' 2>/dev/null || true` and
# tested the result with `-z`. That happened to survive an error payload —
# `jq` yields nothing for one — but it decided on the SHAPE of the output
# rather than on whether the call succeeded, and it could not tell a missing
# issue from a revoked token. The github twin's identical `-z` test did not
# survive: `gh` writes its error body to stdout, so the branch was dead.
rc=0
PARENT_JSON=$(glab issue view "$NUM" --repo "$PROJECT_ID" --output json 2>/dev/null) || rc=$?
if [ "$rc" -ne 0 ] || [ -z "$PARENT_JSON" ]; then
  # `glab` does not hand back a distinguishable status here, so this says only
  # what it knows. Claiming "not found" over an auth failure is the same class
  # of invented certainty this script exists to refuse.
  echo "✗ could not read issue #$NUM in $PROJECT_ID — it may not exist" >&2
  echo "  This is not a verdict: the gate could not see the parent." >&2
  exit 3
fi
PARENT_STATE=$(printf '%s' "$PARENT_JSON" | jq -r '.state // empty' 2>/dev/null || true)
if [ -z "$PARENT_STATE" ]; then
  echo "✗ the state of #$NUM was not readable JSON — refusing to answer" >&2
  exit 3
fi

if [ "$PARENT_STATE" = "closed" ]; then
  echo "ℹ #$NUM is already closed — nothing to gate"
  exit 12
fi

# Children carry a scoped label `parent::#NNN`.
#
# This carried the GitHub backend's defect in a shape no grep for `|| echo 0`
# would find. The previous read was `glab … --opened 2>/dev/null | wc -l`:
# stderr discarded, and a failed command produces no lines, so `wc -l` returned
# 0 and the gate printed "safe to close". The coercion was the pipe itself.
# Counting rendered lines was also wrong on its own terms — the default output
# is a human table, not one issue per line.
#
# JSON, every state, an explicit page size, and an exit code that is checked.
# `--per-page 500` matches the sibling `sweep-closed.sh`; every state because
# telling "no child is linked" from "every child is closed" needs the total.
rc=0
CHILDREN=$(glab issue list --repo "$PROJECT_ID" \
  --label "parent::#$NUM" --all --per-page 500 --output json 2>/dev/null) || rc=$?
if [ "$rc" -ne 0 ] || [ -z "$CHILDREN" ]; then
  echo "✗ could not read the children of #$NUM — refusing to answer" >&2
  echo "  This is not a verdict: the gate could not see the labelled issues." >&2
  exit 3
fi

TOTAL=$(printf '%s' "$CHILDREN" | jq 'length' 2>/dev/null || echo "")
if [ -z "$TOTAL" ]; then
  echo "✗ the child listing for #$NUM was not readable JSON — refusing to answer" >&2
  exit 3
fi
OPEN_LIST=$(printf '%s' "$CHILDREN" \
  | jq -r '.[] | select(.state == "opened") | "  - #\(.iid) — \(.title)"')
OPEN=$(printf '%s' "$OPEN_LIST" | grep -c . || true)

if [ "$OPEN" -gt 0 ]; then
  echo "✗ #$NUM has $OPEN open child issue(s) of $TOTAL — close them first"
  printf '%s\n' "$OPEN_LIST"
  exit 11
fi

if [ "$TOTAL" -eq 0 ]; then
  echo "✓ #$NUM has no children labelled parent::#$NUM — no cascade applies"
else
  echo "✓ #$NUM safe to close — all $TOTAL child issue(s) are closed"
fi
exit 0
