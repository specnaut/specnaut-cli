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

# Every argument is judged before _config.sh asks for a token. The limit is a
# page size, and it reaches the query string: digits only.
LIMIT=100
RESET=0
SEEK_END=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --reset) RESET=1; shift ;;
    --seek-end) SEEK_END=1; shift ;;
    --limit) LIMIT=${2-}; [ "$#" -lt 2 ] || shift; shift ;;
    *) echo "usage: reconcile.sh [--reset] [--seek-end] [--limit N]" >&2; exit 2 ;;
  esac
done
[[ $LIMIT =~ ^[1-9][0-9]{0,2}$ ]] || { echo "reconcile.sh: --limit is a page size, 1 to 999" >&2; exit 2; }

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"

STATE="$ROOT/.specnaut/.cloud-cursor-$PROJECT_KEY"
[ "$RESET" = "1" ] && rm -f "$STATE"

CURSOR=""
[ -f "$STATE" ] && CURSOR="$(cat "$STATE")"

while :; do
  URL="$API_BASE/activity?projectKey=$PROJECT_KEY&limit=$LIMIT"
  if [ -n "$CURSOR" ]; then
    URL="$URL&cursor=$(printf '%s' "$CURSOR" | jq_lf -sRr @uri)"
  fi

  RESP=$(cloud_curl "$URL")
  if ! echo "$RESP" | jq_lf -e '.ok' >/dev/null 2>&1; then
    echo "✗ reconcile failed: $RESP" >&2
    exit 1
  fi

  # In seek-end mode we only advance the cursor, never emit transitions.
  if [ "$SEEK_END" != "1" ]; then
    # One `->` per row: the separator between its two stages.
    echo "$RESP" | jq_lf -r '
      def stage: (. // "—") | tostring | split("->") | join("→");
      .events[]
      | (.number | if type == "number" then . else "?" end) as $n
      | if .kind == "created"
        then "CREATED \($n) -> \(.toStage | stage)"
        else "MOVED \($n) \(.fromStage | stage) -> \(.toStage | stage)"
        end
    '
  fi

  CURSOR=$(echo "$RESP" | jq_lf -r '.cursor // empty')
  [ -n "$CURSOR" ] && printf '%s' "$CURSOR" > "$STATE"

  [ "$(echo "$RESP" | jq_lf -r '.hasMore')" = "true" ] || break
done
