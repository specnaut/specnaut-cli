#!/usr/bin/env bash
# Post a clarification comment on a GitLab issue.
# Usage: clarify-comment.sh <number> "<question>"
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 2 ]; then
  echo 'usage: clarify-comment.sh <number> "<question>"' >&2
  exit 2
fi

glab issue note "$1" --repo "$PROJECT_ID" --message "$2"
