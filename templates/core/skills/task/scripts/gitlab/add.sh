#!/usr/bin/env bash
# Create a GitLab Issue with the Status::Backlog scoped label. Optional
# `--parent <num>` flag adds a `parent::#NNN` scoped label so the new
# issue can be discovered as a child of an existing parent. (GitLab's
# native Epics API is Premium-only; the scoped-label fallback works on
# every tier and stays consistent with the existing Status::* pattern.)
#
# Usage:
#   add.sh "<title>" [body] [labels-csv] [--parent <num>]
set -euo pipefail

# Parse arguments before sourcing _config.sh so `--help` and unknown-flag
# handling work regardless of whether the backlog backend is configured.
PARENT=""
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      echo 'usage: add.sh "<title>" [body] [labels-csv] [--parent <num>]'
      exit 0
      ;;
    --parent)
      if [ $# -lt 2 ]; then
        echo 'usage: add.sh "<title>" [body] [labels-csv] [--parent <num>]' >&2
        exit 2
      fi
      PARENT="$2"
      shift 2
      ;;
    --*)
      echo "add.sh: unknown flag '$1'" >&2
      echo 'usage: add.sh "<title>" [body] [labels-csv] [--parent <num>]' >&2
      exit 2
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

if [ "${#ARGS[@]}" -lt 1 ]; then
  echo 'usage: add.sh "<title>" [body] [labels-csv] [--parent <num>]' >&2
  exit 2
fi
TITLE="${ARGS[0]}"
BODY="${ARGS[1]:-}"
EXTRA_LABELS="${ARGS[2]:-}"

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

LABELS="Status::Backlog"
if [ -n "$EXTRA_LABELS" ]; then
  LABELS="$LABELS,$EXTRA_LABELS"
fi
if [ -n "$PARENT" ]; then
  LABELS="$LABELS,parent::#$PARENT"
fi

CREATE_ARGS=(
  "--repo" "$PROJECT_ID"
  "--title" "$TITLE"
  "--label" "$LABELS"
  "--description" "$BODY"
)

URL=$(glab issue create "${CREATE_ARGS[@]}" 2>&1 | grep -oE 'https://[^ ]+' | head -1)
echo "✓ created: $URL"
if [ -n "$PARENT" ]; then
  echo "✓ tagged parent::#$PARENT (scoped label)"
fi
