#!/usr/bin/env bash
# Resolve the two columns grooming moves an item between (#654).
#
# Grooming ends with a promotion: the item leaves the board's INTAKE column
# for its READY column, so the next run can skip it by column alone. The
# names are the board's, not Specnaut's — `Backlog` and `Ready` are only the
# default — so they are read from the board once per run, and an answer the
# user gave once is kept in `.specnaut/backlog-config.yml`:
#
#   intake_column: Backlog
#   ready_column: Ready      # `none` = groom without promoting
#
# Usage:
#   groom-columns.sh                       resolve; prints INTAKE= READY= PROMOTE= OPTIONS=
#   groom-columns.sh --set <key> <value>   persist intake_column | ready_column
#
# Exit codes:
#   0   resolved — or ready_column is `none` (PROMOTE=no)
#   4   a column is not on the board: ask the user ONCE, then --set the answer
#       (prints MISSING= and the board's OPTIONS= to build the question from)
#   2   usage, or backlog-config.yml missing / incomplete
#   13  the board could not be read — retry or report; never guess a column
set -euo pipefail

# shellcheck source=_config.sh
source "$(dirname "$0")/_config.sh"
require_project

config_value() {
  awk -v key="$1" '
    $0 ~ "^"key":" {
      sub("^"key":[[:space:]]*", "")
      sub(/[[:space:]]+#.*$/, "")
      gsub(/^["'"'"']|["'"'"']$/, "")
      print
      exit
    }
  ' "$CONFIG"
}

# One read of the board's Status options, newline-separated.
board_options() {
  local json
  json="$(gh project field-list "$PROJECT_NUMBER" --owner "$REPO_OWNER" --format json 2>/dev/null)" || return 1
  printf '%s' "$json" | jq -er '[.fields[] | select(.name=="Status")][0].options // empty | .[].name' 2>/dev/null
}

# The board's own spelling of <name>, matched case-insensitively; empty if absent.
on_board() {
  local want lower
  want="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  while IFS= read -r opt; do
    lower="$(printf '%s' "$opt" | tr '[:upper:]' '[:lower:]')"
    if [ "$lower" = "$want" ]; then printf '%s' "$opt"; return 0; fi
  done <<< "$OPTIONS"
  return 1
}

if ! OPTIONS="$(board_options)" || [ -z "$OPTIONS" ]; then
  echo "error: could not read the Status options of project #$PROJECT_NUMBER — not checked; retry or report" >&2
  exit 13
fi

if [ "${1:-}" = "--set" ]; then
  key="${2:-}"; value="${3:-}"
  case "$key" in intake_column | ready_column) ;; *)
    echo "usage: groom-columns.sh --set <intake_column|ready_column> <column|none>" >&2; exit 2 ;;
  esac
  [ -n "$value" ] || { echo "usage: groom-columns.sh --set $key <column|none>" >&2; exit 2; }
  if [ "$key" = "ready_column" ] && [ "$value" = "none" ]; then
    :
  elif name="$(on_board "$value")"; then
    value="$name"
  else
    echo "error: '$value' is not a Status column of project #$PROJECT_NUMBER" >&2
    printf 'OPTIONS=%s\n' "$(printf '%s' "$OPTIONS" | paste -sd '|' -)"
    exit 4
  fi
  tmp="$(mktemp)"
  awk -v key="$key" -v line="$key: \"$value\"" '
    $0 ~ "^"key":" { print line; done = 1; next } { print }
    END { if (!done) print line }
  ' "$CONFIG" > "$tmp" && mv "$tmp" "$CONFIG"
  echo "✓ $key: $value"
  exit 0
fi

intake_want="$(config_value intake_column)"; intake_want="${intake_want:-Backlog}"
ready_want="$(config_value ready_column)"; ready_want="${ready_want:-Ready}"

missing=""
intake="$(on_board "$intake_want")" || missing="$missing intake_column=$intake_want"
promote=yes
if [ "$ready_want" = "none" ]; then
  ready=""; promote=no
else
  ready="$(on_board "$ready_want")" || missing="$missing ready_column=$ready_want"
fi

printf 'INTAKE=%s\n' "${intake:-}"
printf 'READY=%s\n' "${ready:-}"
printf 'PROMOTE=%s\n' "$promote"
printf 'OPTIONS=%s\n' "$(printf '%s' "$OPTIONS" | paste -sd '|' -)"
if [ -n "$missing" ]; then
  printf 'MISSING=%s\n' "${missing# }"
  exit 4
fi
