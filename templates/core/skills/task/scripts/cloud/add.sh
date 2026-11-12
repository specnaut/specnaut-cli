#!/usr/bin/env bash
# Create a task on the Specnaut Cloud board.
#
# Usage: add.sh "<title>" [body] [--parent <num>] [--body-file <path>]
#
# `--body-file` reads the body from a file, in place of the positional one.
# Every text travels in the JSON request body, sent from a file (cloud_send,
# _cloud_send.sh), never as an argument.
#
# `--parent` makes the new task a sub-task of an existing one, in the same
# shape as the local and github versions. It travels as `parentNumber` on the
# versioned public contract — by number, never by an internal identifier.
# Exit: 0 created · 1 the board refused · 2 usage · 14 a text its secret check refused
# (require_clean_text, _clean_text.sh), nothing sent
set -euo pipefail

# shellcheck source=../_backlog_args.sh
. "$(dirname "$0")/_backlog_args.sh"
parse_add_args 'usage: add.sh "<title>" [body] [--parent <num>] [--body-file <path>]' 0 "$@"

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"
# shellcheck source=../_backlog_plan.sh
. "$(dirname "$0")/_backlog_plan.sh"
# shellcheck source=./_cloud_send.sh
. "$(dirname "$0")/_cloud_send.sh"
if [ -n "$PARENT" ]; then PARENT=$(require_issue_number "$PARENT") || exit 2; fi
require_clean_text title "$TITLE"
if [ -n "$BODY_FILE" ]; then require_clean_file body "$BODY_FILE"; BODY=$(cat -- "$CLEAN_FILE"); else require_clean_text body "$BODY"; fi

# Each text NUL-ended: the one byte no shell variable holds, so none ends early.
RESP=$(printf '%s\0' "$TITLE" "$BODY" |
  jq_lf -c -Rs --arg k "$PROJECT_KEY" --arg p "$PARENT" 'split("\u0000") as [$t, $b]
   | { projectKey: $k, title: $t }
   + (if $b == "" then {} else { body: $b } end)
   + (if $p == "" then {} else { parentNumber: ($p | tonumber) } end)' |
  cloud_send POST "$API_BASE/tasks")

KEY=$(echo "$RESP" | jq_lf -r '.task.key // empty')
if [ -n "$KEY" ]; then
  echo "✓ created: $KEY"
else
  echo "✗ create failed: $RESP" >&2
  exit 1
fi
