#!/usr/bin/env bash
# Create a task on the Specnaut Cloud board.
#
# Usage: add.sh "<title>" [body] [--parent <num>] [--body-file <path>]
#
# `--body-file` reads the body from a file, in place of the positional one; it
# travels in the JSON payload, with no shell between the two.
#
# `--parent` makes the new task a sub-task of an existing one, in the same
# shape as the local and github versions. It travels as `parentNumber` on the
# versioned public contract — by number, never by an internal identifier.
set -euo pipefail

USAGE='usage: add.sh "<title>" [body] [--parent <num>] [--body-file <path>]'
PARENT=""
BODY_FILE=""
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -h | --help)
      echo "$USAGE"
      exit 0
      ;;
    --parent)
      if [ "$#" -lt 2 ]; then
        echo "$USAGE" >&2
        exit 2
      fi
      PARENT="$2"
      shift 2
      ;;
    --body-file)
      [ $# -ge 2 ] && [ -f "$2" ] || { echo "add.sh: --body-file needs a file" >&2; exit 2; }
      BODY_FILE="$2"
      shift 2
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done
set -- ${ARGS[@]+"${ARGS[@]}"}

if [ "$#" -lt 1 ]; then
  echo "$USAGE" >&2
  exit 2
fi
TITLE="$1"
BODY="${2:-}"
if [ -n "$BODY_FILE" ] && [ -n "$BODY" ]; then
  echo "add.sh: give a body or --body-file, not both" >&2
  exit 2
fi

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"
if [ -n "$PARENT" ]; then PARENT=$(require_issue_number "$PARENT") || exit 2; fi
if [ -n "$BODY_FILE" ]; then BODY=$(cat -- "$BODY_FILE"); fi

PAYLOAD=$(jq_lf -n --arg k "$PROJECT_KEY" --arg t "$TITLE" --arg b "$BODY" --arg p "$PARENT" \
  '{ projectKey: $k, title: $t }
   + (if $b == "" then {} else { body: $b } end)
   + (if $p == "" then {} else { parentNumber: ($p | tonumber) } end)')

RESP=$(cloud_curl -X POST "$API_BASE/tasks" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

KEY=$(echo "$RESP" | jq_lf -r '.task.key // empty')
if [ -n "$KEY" ]; then
  echo "✓ created: $KEY"
else
  echo "✗ create failed: $RESP" >&2
  exit 1
fi
