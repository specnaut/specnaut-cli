#!/usr/bin/env bash
# kanban.sh [--no-open] -- the configured board, in the browser (cli#803).
# Read-only: it writes nothing to the tracker or the tree.
#
# Prints `URL: <url>`, then opens it with the system default browser
# (_open_url.sh; `--no-open` prints only). A backend with no web address for
# its board prints its defined fallback instead (`CLOUD: ...`, `LOCAL: ...`)
# and opens nothing. Where the address comes from is each backend's _board.sh.
#
# Exit: 0 printed, a fallback included -- 2 a bad argument, or
# backlog-config.yml missing or a field unfilled (stderr names it) -- 13 the
# board could not be resolved (stderr says how to fix access; never a reason
# to edit the config).
set -euo pipefail

OPEN=1
case "${1:-}" in
  "") ;;
  --no-open) OPEN=0 ;;
  *) echo "usage: kanban.sh [--no-open]" >&2; exit 2 ;;
esac

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"
# shellcheck source=./_board.sh
. "$(dirname "$0")/_board.sh"
# shellcheck source=./_open_url.sh
. "$(dirname "$0")/_open_url.sh"

url=$(board_url)
if [ -z "$url" ]; then
  rc=0
  board_fallback || rc=$?
  exit "$rc"
fi
echo "URL: $url"
[ "$OPEN" = 0 ] || open_url "$url"
