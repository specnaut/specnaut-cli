#!/usr/bin/env bash
# Self-gates on .specflow/installed.lock: if the project's backlog
# backend is `github` or `gitlab`, checks the corresponding CLI is
# installed and authenticated. Prints a stderr warning at SessionStart
# so the user knows before they try to run a backlog command.
#
# Always exits 0 — this is informational, not blocking.
set -euo pipefail

LOCK="$(pwd)/.specflow/installed.lock"
[ -f "$LOCK" ] || exit 0

BACKEND=$(awk '/^backlog_backend:/ {gsub(/[\047"]/, "", $2); print $2; exit}' "$LOCK")

case "$BACKEND" in
  github)
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
    ;;
  gitlab)
    if ! command -v glab >/dev/null 2>&1; then
      cat >&2 <<'WARN'
warn: backlog backend is 'gitlab' but the `glab` CLI is not on PATH.
      Install from https://gitlab.com/gitlab-org/cli — backlog scripts
      will fail until then.
WARN
      exit 0
    fi
    if ! glab auth status >/dev/null 2>&1; then
      cat >&2 <<'WARN'
warn: backlog backend is 'gitlab' but `glab` is not authenticated.
      Run `glab auth login` — backlog scripts will fail until then.
WARN
    fi
    ;;
  *)
    exit 0
    ;;
esac

exit 0
