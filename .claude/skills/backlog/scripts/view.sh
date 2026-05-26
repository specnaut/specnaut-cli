#!/usr/bin/env bash
# Show one issue's title, body, current Status on Project #4, and any
# comments. Useful when about to clarify an item.
#
# Status comes from `gh issue view --json projectItems` (~2 GraphQL points
# via the gh CLI's REST-ish JSON projection — much cheaper than the
# hand-rolled query that used to live here). Body + comments come from
# `gh issue view --comments` (REST).
#
# Usage: view.sh [--repo <short>] <ISSUE_NUMBER>
#   <short> ∈ specflow | specflow-cloud | specflow-monorepo (default: specflow)
set -euo pipefail

. "$(dirname "$0")/_repo.sh"
resolve_repo "$@"
set -- ${REPO_REMAINING_ARGS[@]+"${REPO_REMAINING_ARGS[@]}"}

ISSUE="${1:?usage: view.sh [--repo <short>] <issue-number>}"

STATUS=$(gh issue view "$ISSUE" --repo "$REPO" --json projectItems \
  | jq -r '.projectItems[0].status.name // "—"')

echo "════ $REPO#$ISSUE — Status: $STATUS ════"
gh issue view "$ISSUE" --repo "$REPO" --comments
