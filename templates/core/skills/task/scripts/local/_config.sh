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

# jq_lf <jq args…> — jq, for every call in this script family (cli#701). A
# native Windows jq.exe writes stdout in text mode, every \n as \r\n, so a
# value read with `$(jq -r …)` kept a \r: a path that opens nothing, an id the
# tracker does not know, a count `[ -gt ]` refuses. The \r\n is undone only
# when the jq on PATH was measured writing it, once, as this file is sourced —
# exact, never "drop every \r": a \r a value carries itself survives. jq's
# exit status and its trailing newline are kept. Every copy of this helper is
# the same text (tests/scripts/jq_crlf_test.ts).
JQ_CRLF=0
case $(jq -n 1 2>/dev/null; printf .) in *$'\r\n.') JQ_CRLF=1 ;; esac
jq_lf() {
  local _o _rc=0
  _o=$(_r=0; jq "$@" || _r=$?; printf .; exit "$_r") || _rc=$?
  _o=${_o%.}
  if [ "$JQ_CRLF" = 1 ]; then _o=${_o//$'\r\n'/$'\n'}; fi
  printf '%s' "$_o"
  return "$_rc"
}

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BACKLOG_DIR="$ROOT/.specnaut/backlog"
INDEX="$ROOT/.specnaut/backlog.md"

export ROOT BACKLOG_DIR INDEX

# require_issue_number <id> — <id> as a bare decimal issue number on stdout, or
# a refusal on stderr and status 2. Every script that takes an id runs it first:
# the id reaches a URL path, a query variable or a file glob, so it is digits
# and nothing else — never a URL, an `@file` or query text. Zero padding is
# dropped (`042` is 42, never octal). Every copy is the same text
# (tests/scripts/backlog_issue_number_test.ts).
require_issue_number() {
  local n=${1:-}
  n=${n#"${n%%[!0]*}"}
  if [[ $n =~ ^[1-9][0-9]{0,9}$ ]]; then printf '%s\n' "$n"; return 0; fi
  printf '%s: not an issue number: %q\n' "${0##*/}" "${1:-}" >&2
  return 2
}

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
