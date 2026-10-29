#!/usr/bin/env bash
# List items on the configured GitHub Project, with Status. Optional filter.
#
# Uses `gh issue list --json projectItems` — the gh CLI exposes the Project V2
# Status field via its REST-ish JSON projection, costing ~1 GraphQL point per
# call (vs ~20 for the bulky `repository.issues[].projectItems[].fieldValues[]`
# query that lived here previously and was the main rate-limit offender).
#
# Usage: list.sh [Status]
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

FILTER="${1:-}"

# `Done` is the one Status whose membership implies a CLOSED issue.
#
# Every other column holds work in flight, so `--state open` is exactly right
# for them — widening those would pull in issues closed as `not planned`, and
# issues whose card never moved off its column before being closed. Those are
# precisely the rows a grooming sweep must not read as live work.
#
# `Done` is different. On any board where finishing work means closing the
# issue, the intersection of "carded Done" and "still open" is empty, so
# `list.sh Done` answered nothing at exit 0 — silence indistinguishable from an
# empty column. That implication does not need GitHub's built-in "Auto-close
# issue" workflow: a close convention alone produces it, which is why this is
# phrased as the invariant and not as a workflow name.
#
# `--state all`, not `--state closed`: a `Done` card is not *guaranteed* to be
# closed, and a board that leaves them open must keep working.
#
# Residual, deliberately not fixed here: `--limit 200` is a window over the
# repo's issues, and on this path that window is shared with closed history. A
# board whose `Done` cards predate its 200 most recent issues still
# under-reports. Widening the cap is a separate change.
STATE=open
if [ "$FILTER" = "Done" ]; then
  STATE=all
fi

JSON=$(gh issue list --repo "$REPO" --state "$STATE" --limit 200 \
  --json number,title,projectItems)

echo "$JSON" | jq -r --arg filter "$FILTER" '
  .[]
  | . as $issue
  | (.projectItems[0].status.name // "—") as $status
  | select($issue.projectItems | length > 0)
  | select($filter == "" or $status == $filter)
  | "  #\($issue.number)  \($status)  \($issue.title)"
'
