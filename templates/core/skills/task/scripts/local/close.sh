#!/usr/bin/env bash
# Close a backlog item: on this backend the close IS the move to Done, with
# `resolution: not-planned` beside it for that reason. It checks no gate: the
# executor runs cascade-check.sh first.
#
# Usage: close.sh <number> [completed|not_planned]   (completed by default)
# Exit: move.sh's — 0 closed · 1 no such item · 2 usage
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

[ "$#" -ge 1 ] && [ "$#" -le 2 ] || { echo 'usage: close.sh <number> [completed|not_planned]' >&2; exit 2; }
NUM=$(require_issue_number "$1") || exit 2
case "${2:-completed}" in
  completed) exec bash "$(dirname "$0")/move.sh" "$NUM" Done ;;
  not_planned) exec bash "$(dirname "$0")/move.sh" "$NUM" Done --not-planned ;;
  *) echo "close.sh: a reason is completed or not_planned" >&2; exit 2 ;;
esac
