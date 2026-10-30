#!/usr/bin/env bash
# After a merge: settle the board for the shipped items (phases/merge-close.md,
# spec 042) — the local half. On this backend there is no separate issue to
# close: `move.sh <n> Done` IS the close, in one write, and there is no board
# to reconcile against. The loop, the lines and the exit table are the shared
# body, _close_shipped.sh, beside this file.
#
# Usage: close-shipped.sh <issue-number>…
set -uo pipefail
here=$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

confirm_closed() { :; }
reconcile() { :; }

# shellcheck source=../_close_shipped.sh
. "$here/_close_shipped.sh"
