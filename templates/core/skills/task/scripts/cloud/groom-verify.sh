#!/usr/bin/env bash
# Prove a groom run left every task it processed complete — Specnaut Cloud.
#
# This script FETCHES and NORMALISES; it decides nothing. What "complete" means
# lives in `.specnaut/scripts/bash/groom-rules.sh`, and its header is the rule.
#
# The record of each task is `item-record.sh`'s — one fetch, one token per
# run, read here and by `read-items.sh` alike; its header says where each part
# comes from. Cloud serves no comment back, so the ready column is the one
# outcome this backend can prove.
#
# Usage: groom-verify.sh [--ready <column>|none] <number>...
# Output and exit codes: those of groom-rules.sh — plus exit 2 when a task
# cannot be fetched (API error, no such task, not authenticated). Nothing is
# reported complete that was not read.
set -euo pipefail

usage() { echo "usage: groom-verify.sh [--ready <column>|none] <number>..." >&2; exit 2; }

READY="Ready"
ITEMS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --ready) [ -n "${2:-}" ] || usage; READY="$2"; shift 2 ;;
    -h | --help) usage ;;
    '' | *[!0-9]*) echo "groom-verify.sh: not a task number: '$1'" >&2; usage ;;
    *) ITEMS+=("$1"); shift ;;
  esac
done
[ "${#ITEMS[@]}" -gt 0 ] || usage

# No `_config.sh` here: `item-record.sh` resolves the run's one token, and
# refuses 0 or an overlong number itself.
RULES="$(dirname "$0")/../bash/groom-rules.sh"
RECORDS=$(bash "$(dirname "$0")/item-record.sh" "${ITEMS[@]}") ||
  { echo "groom-verify.sh: nothing verified" >&2; exit 2; }

rc=0
printf '%s\n' "$RECORDS" | bash "$RULES" --ready "$READY" || rc=$?
exit "$rc"
