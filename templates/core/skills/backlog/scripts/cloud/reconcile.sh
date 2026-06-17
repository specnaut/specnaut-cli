#!/usr/bin/env bash
# Poll Specnaut Cloud for board stage transitions since the last run and emit
# them for the product-owner to act on — the CLI half of the poll/reconcile
# model (no webhook, no daemon).
#
# A per-project cursor is stored at `.specnaut/.cloud-cursor-<KEY>`. Each call
# drains every transition newer than the cursor (following `hasMore`) and
# advances it. Output is one machine-readable line per transition:
#
#   CREATED <number> -> <toStage>
#   MOVED   <number> <fromStage> -> <toStage>
#
# The product-owner maps each line to a stage hook (see the agent doc,
# "Cloud stage reconcile"). Re-running is safe: delivery is at-least-once and
# the PO's hooks are idempotent. First run with no cursor replays the whole
# history — pass `--reset` to drop the cursor, or `--seek-end` to fast-forward
# past existing history without acting (bootstrap a fresh board).
#
# Usage: reconcile.sh [--reset] [--seek-end] [--limit N]
set -euo pipefail

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

LIMIT=100
RESET=0
SEEK_END=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --reset) RESET=1; shift ;;
    --seek-end) SEEK_END=1; shift ;;
    --limit) LIMIT="${2:?--limit needs a value}"; shift 2 ;;
    *) echo "usage: reconcile.sh [--reset] [--seek-end] [--limit N]" >&2; exit 2 ;;
  esac
done

STATE="$ROOT/.specnaut/.cloud-cursor-$PROJECT_KEY"
AUTH=(-H "Authorization: Bearer $API_TOKEN")

[ "$RESET" = "1" ] && rm -f "$STATE"

CURSOR=""
[ -f "$STATE" ] && CURSOR="$(cat "$STATE")"

while :; do
  URL="$API_BASE/activity?projectKey=$PROJECT_KEY&limit=$LIMIT"
  if [ -n "$CURSOR" ]; then
    URL="$URL&cursor=$(printf '%s' "$CURSOR" | jq -sRr @uri)"
  fi

  RESP=$(curl -fsS "$URL" "${AUTH[@]}")
  if ! echo "$RESP" | jq -e '.ok' >/dev/null 2>&1; then
    echo "✗ reconcile failed: $RESP" >&2
    exit 1
  fi

  # In seek-end mode we only advance the cursor, never emit transitions.
  if [ "$SEEK_END" != "1" ]; then
    echo "$RESP" | jq -r '
      .events[]
      | if .kind == "created"
        then "CREATED \(.number) -> \(.toStage // "—")"
        else "MOVED \(.number) \(.fromStage // "—") -> \(.toStage // "—")"
        end
    '
  fi

  CURSOR=$(echo "$RESP" | jq -r '.cursor // empty')
  [ -n "$CURSOR" ] && printf '%s' "$CURSOR" > "$STATE"

  [ "$(echo "$RESP" | jq -r '.hasMore')" = "true" ] || break
done
