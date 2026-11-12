#!/usr/bin/env bash
# Create a GitLab Issue with the Status::Backlog scoped label. Optional
# `--parent <num>` flag adds a `parent::#NNN` scoped label so the new
# issue can be discovered as a child of an existing parent. (GitLab's
# native Epics API is Premium-only; the scoped-label fallback works on
# every tier and stays consistent with the existing Status::* pattern.)
#
# Usage:
#   add.sh "<title>" [body] [labels-csv] [--parent <num>] [--body-file <path>]
#
# `--body-file` reads the body from a file, in place of the positional one
# (pass "" there to give labels); it reaches glab as one argument, no shell.
# Exit: 0 created · 2 usage · 14 a text its secret check refused
# (require_clean_text, _clean_text.sh), nothing sent · other glab's
set -euo pipefail

# Parse arguments before sourcing _config.sh so `--help` and unknown-flag
# handling work regardless of whether the backlog backend is configured.
# shellcheck source=../_backlog_args.sh
. "$(dirname "$0")/_backlog_args.sh"
parse_add_args 'usage: add.sh "<title>" [body] [labels-csv] [--parent <num>] [--body-file <path>]' 1 "$@"
EXTRA_LABELS="${EXTRA[0]:-}"

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"
# shellcheck source=../_backlog_plan.sh
. "$(dirname "$0")/_backlog_plan.sh"
if [ -n "$PARENT" ]; then PARENT=$(require_issue_number "$PARENT") || exit 2; fi
require_clean_text title "$TITLE"
if [ -n "$BODY_FILE" ]; then require_clean_file body "$BODY_FILE"; BODY=$(cat -- "$CLEAN_FILE"); else require_clean_text body "$BODY"; fi
# GitLab creates a label it does not know, from its name: a label is text it keeps.
require_clean_text label "$EXTRA_LABELS"

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
