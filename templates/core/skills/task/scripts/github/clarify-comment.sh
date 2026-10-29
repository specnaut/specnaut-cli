#!/usr/bin/env bash
# Post a clarification comment on a GitHub issue.
# Usage: clarify-comment.sh <number> "<question>"
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 2 ]; then
  echo 'usage: clarify-comment.sh <number> "<question>"' >&2
  exit 2
fi

gh issue comment "$1" --repo "$REPO" --body "$2"
