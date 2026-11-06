#!/usr/bin/env bash
# Show one GitLab issue + its comments.
# Usage: view.sh <number>
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <number>" >&2
  exit 2
fi
NUM=$(require_issue_number "$1") || exit 2

glab issue view "$NUM" --repo "$PROJECT_ID" --comments
