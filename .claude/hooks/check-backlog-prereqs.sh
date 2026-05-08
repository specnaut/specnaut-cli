#!/usr/bin/env bash
# Self-gates on .specflow/installed.lock: if the project's backlog
# backend is `github` and `gh` is missing or unauthenticated, prints a
# stderr warning at SessionStart so the user knows before they try to
# run a backlog command.
#
# Always exits 0 — this is informational, not blocking.
set -euo pipefail

LOCK="$(pwd)/.specflow/installed.lock"
[ -f "$LOCK" ] || exit 0

BACKEND=$(awk '/^backlog_backend:/ {gsub(/[\047"]/, "", $2); print $2; exit}' "$LOCK")
[ "$BACKEND" = "github" ] || exit 0

if ! command -v gh >/dev/null 2>&1; then
  cat >&2 <<'WARN'
warn: backlog backend is 'github' but the `gh` CLI is not on PATH.
      Install from https://cli.github.com — backlog scripts will fail
      until then.
WARN
  exit 0
fi

if ! gh auth status >/dev/null 2>&1; then
  cat >&2 <<'WARN'
warn: backlog backend is 'github' but `gh` is not authenticated.
      Run `gh auth login` (and `gh auth refresh -s project` if the
      Project scope is missing) — backlog scripts will fail until then.
WARN
fi

exit 0
