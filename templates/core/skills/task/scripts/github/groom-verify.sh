#!/usr/bin/env bash
# Prove a groom run left every issue it processed complete — GitHub backend.
#
# This script FETCHES and NORMALISES; it decides nothing. What "complete" means
# lives in `.specnaut/scripts/bash/groom-rules.sh`, and its header is the rule.
#
# The record of each issue is `item-record.sh`'s — one fetch, read here and by
# `read-items.sh` alike; its header says where each part comes from.
#
# Usage: groom-verify.sh [--ready <column>|none] <number>...
#   --ready  the board's ready column, as `groom-columns.sh` resolved it
#            (READY=…; `none` when PROMOTE=no). Default `Ready`.
# Output and exit codes: those of groom-rules.sh — plus exit 2 when an issue
# cannot be fetched (gh error, rate limit, missing scope, unknown issue).
# Nothing is reported complete that was not read.
set -euo pipefail

usage() { echo "usage: groom-verify.sh [--ready <column>|none] <number>..." >&2; exit 2; }

# shellcheck source=./_config.sh
. "$(dirname "$0")/_config.sh"
RULES="$(dirname "$0")/../bash/groom-rules.sh"

READY="Ready"
ITEMS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --ready) [ -n "${2:-}" ] || usage; READY="$2"; shift 2 ;;
    -h | --help) usage ;;
    *) n=$(require_issue_number "$1") || usage; ITEMS+=("$n"); shift ;;
  esac
done
[ "${#ITEMS[@]}" -gt 0 ] || usage
RECORDS=$(bash "$(dirname "$0")/item-record.sh" "${ITEMS[@]}") ||
  { echo "groom-verify.sh: nothing verified" >&2; exit 2; }

rc=0
printf '%s\n' "$RECORDS" | bash "$RULES" --ready "$READY" || rc=$?
exit "$rc"
