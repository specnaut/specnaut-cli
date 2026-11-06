#!/usr/bin/env bash
# After a merge: settle the board for the shipped items (phases/merge-close.md,
# spec 042) — the cloud half. On this backend there is no separate issue to
# close: the move to the board's terminal column IS the close, in one write,
# and there is no board to reconcile against. That column is the last by
# order, whatever it is called (`columns.sh --terminal`, `terminal_column` in
# _config.sh). The loop, the lines and the exit table are the shared
# body, _close_shipped.sh, beside this file.
#
# Usage: close-shipped.sh <issue-number>…
set -uo pipefail
here=$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

confirm_closed() { :; }
reconcile() { :; }
done_status() { bash "$here/columns.sh" --terminal 2>/dev/null; }

# shellcheck source=../_close_shipped.sh
. "$here/_close_shipped.sh"
