#!/usr/bin/env bash
# Append a clarification-request comment to a backlog issue. Use when the
# Product Owner subagent can't fully clarify an item from the linked docs
# alone and needs Kevin's input asynchronously.
# Usage: clarify-comment.sh [--repo <short>] <ISSUE_NUMBER> <COMMENT_BODY>
#   <short> ∈ specflow | specflow-cloud | specflow-monorepo (default: specflow)
set -euo pipefail

. "$(dirname "$0")/_repo.sh"
resolve_repo "$@"
set -- ${REPO_REMAINING_ARGS[@]+"${REPO_REMAINING_ARGS[@]}"}

ISSUE="${1:?usage: clarify-comment.sh [--repo <short>] <issue-number> <comment>}"
shift
COMMENT="$*"

if [[ -z "$COMMENT" ]]; then
  echo "comment body is empty" >&2
  exit 1
fi

gh issue comment "$ISSUE" --repo "$REPO" --body "$COMMENT" >/dev/null
echo "comment posted on $REPO#$ISSUE"
