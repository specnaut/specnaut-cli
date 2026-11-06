#!/usr/bin/env bash
# Print one backlog item by number.
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <number>" >&2
  exit 2
fi
NUM=$(require_issue_number "$1") || exit 2
NUM=$(printf "%03d" "$NUM")

shopt -s nullglob
matches=("$BACKLOG_DIR/$NUM-"*.md)
if [ "${#matches[@]}" -eq 0 ]; then
  echo "no backlog item #$NUM" >&2
  exit 1
fi
cat "${matches[0]}"
