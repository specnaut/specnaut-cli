#!/usr/bin/env bash
# Helper for the local (Markdown) backlog backend.
#
# `specnaut init --backlog local` writes no backlog-config.yml at all — the
# local backend is identified by that file's *absence* — so unlike the other
# backends there is nothing to read. This helper exists to give the local
# backend the same `item_url` surface as the others, per
# `backlog-reference-contract`.
#
# Sourced by the other local-backend scripts.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BACKLOG_DIR="$ROOT/.specnaut/backlog"
INDEX="$ROOT/.specnaut/backlog.md"

export ROOT BACKLOG_DIR INDEX

# A Markdown backlog has no browser URL, but it does have a file — so emit a
# repo-relative path that a harness can open. Prints nothing when no task file
# matches. Never fails: a reference must never block a workflow.
item_url() {
  [ -n "${1:-}" ] || return 0
  local padded
  padded=$(printf '%03d' "$1" 2>/dev/null) || return 0
  local candidate
  for candidate in "$BACKLOG_DIR/$padded"-*.md; do
    [ -e "$candidate" ] || continue
    echo ".specnaut/backlog/$(basename "$candidate")"
    return 0
  done
  return 0
}
