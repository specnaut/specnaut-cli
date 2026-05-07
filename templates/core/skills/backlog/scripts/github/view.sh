#!/usr/bin/env bash
# Show one GitHub issue + its comments.
# Usage: view.sh <number>
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <number>" >&2
  exit 2
fi

gh issue view "$1" --repo "$REPO" --comments
