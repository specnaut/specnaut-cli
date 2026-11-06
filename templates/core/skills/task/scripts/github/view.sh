#!/usr/bin/env bash
# Show one GitHub issue: its creation time, fields, body and comments.
# Usage: view.sh <number>
#
# The first line, `created:`, comes from GitHub, before any text an issue's
# author wrote: a `created:` line further down is that text, not the date.
#
# `gh issue view --comments` prints the whole issue only on a terminal. Anywhere
# else it prints the comments alone, so an issue with none prints nothing.
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <number>" >&2
  exit 2
fi
NUM=$(require_issue_number "$1") || exit 2

gh issue view "$NUM" --repo "$REPO" --json createdAt --jq '"created:\t" + .createdAt'

if [ -t 1 ]; then
  gh issue view "$NUM" --repo "$REPO" --comments
else
  gh issue view "$NUM" --repo "$REPO"
  gh issue view "$NUM" --repo "$REPO" --comments
fi
