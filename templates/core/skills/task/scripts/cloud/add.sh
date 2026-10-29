#!/usr/bin/env bash
# Create a task on the Specnaut Cloud board.
#
# Usage: add.sh "<title>" [body] [--parent <num>]
#
# `--parent` makes the new task a sub-task of an existing one, in the same
# shape as the local and github versions. It travels as `parentNumber` on the
# versioned public contract — by number, never by an internal identifier.
set -euo pipefail

PARENT=""
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -h | --help)
      echo 'usage: add.sh "<title>" [body] [--parent <num>]'
      exit 0
      ;;
    --parent)
      if [ "$#" -lt 2 ]; then
        echo 'usage: add.sh "<title>" [body] [--parent <num>]' >&2
        exit 2
      fi
      PARENT="$2"
      case "$PARENT" in
        '' | *[!0-9]*)
          echo "not a task number: '$PARENT'" >&2
          exit 2
          ;;
      esac
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
  echo 'usage: add.sh "<title>" [body] [--parent <num>]' >&2
  exit 2
fi
TITLE="$1"
BODY="${2:-}"

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

PAYLOAD=$(jq -n --arg k "$PROJECT_KEY" --arg t "$TITLE" --arg b "$BODY" --arg p "$PARENT" \
  '{ projectKey: $k, title: $t }
   + (if $b == "" then {} else { body: $b } end)
   + (if $p == "" then {} else { parentNumber: ($p | tonumber) } end)')

RESP=$(curl -fsS -X POST "$API_BASE/tasks" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

KEY=$(echo "$RESP" | jq -r '.task.key // empty')
if [ -n "$KEY" ]; then
  echo "✓ created: $KEY"
else
  echo "✗ create failed: $RESP" >&2
  exit 1
fi
