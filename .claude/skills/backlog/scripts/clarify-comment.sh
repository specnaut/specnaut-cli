#!/usr/bin/env bash
# Append a clarification-request comment to a backlog issue. Use when the
# Product Owner subagent can't fully clarify an item from the linked docs
# alone and needs Kevin's input asynchronously.
# Usage: clarify-comment.sh <ISSUE_NUMBER> <COMMENT_BODY>
set -euo pipefail

ISSUE="${1:?usage: clarify-comment.sh <issue-number> <comment>}"
shift
COMMENT="$*"

if [[ -z "$COMMENT" ]]; then
  echo "comment body is empty" >&2
  exit 1
fi

gh issue comment "$ISSUE" --repo mkrlabs/specflow --body "$COMMENT" >/dev/null
echo "comment posted on #$ISSUE"
