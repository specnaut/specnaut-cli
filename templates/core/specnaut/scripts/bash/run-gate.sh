#!/usr/bin/env bash
# Run one declared quality-gate tier.
#
#   run-gate.sh <fast|full>
#
# Reads `.specnaut/gates.yml` and runs the commands under `fast_gate:` or
# `full_gate:`, in order, from the repository root.
#
# This script is the ONE place the declaration is parsed. The per-child loop
# and the pre-merge step both call it; neither reads the file itself. A second
# parser is a second definition of what a gate is, and the two drift.
#
# It names no test tool, runner or framework, and it never will: the commands
# come from the project's file and are executed verbatim. There is nowhere in
# here for a tool name to be written.
#
# Exit codes:
#   0   every command succeeded, OR the tier is not declared (see below)
#   1   a command exited non-zero — the tier failed
#   2   usage error
#
# A tier that is not declared is NOT a failure. A project with no gates.yml,
# or with an empty list, behaves exactly as it did before this file existed.
# The script says so on stdout rather than passing in silence, because "no
# gate ran" and "the gate passed" are different facts and a caller that cannot
# tell them apart will report the wrong one.
set -uo pipefail

TIER="${1:-}"
case "$TIER" in
  fast|full) ;;
  *) echo "usage: run-gate.sh <fast|full>" >&2; exit 2 ;;
esac

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# .specnaut/scripts/bash/run-gate.sh -> the .specnaut directory
SPECNAUT_DIR="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
GATES="$SPECNAUT_DIR/gates.yml"
REPO_ROOT="$(cd -- "$SPECNAUT_DIR/.." && pwd)"

if [ ! -r "$GATES" ]; then
  echo "no $TIER gate declared — $GATES is absent, so nothing ran"
  exit 0
fi

# Read one flat list. The format is narrow on purpose (see gates.yml): a
# top-level `<tier>_gate:` key, then `  - ` items until the next top-level key.
# Quotes around an item are optional and are stripped as a matched pair only,
# so a command containing a quote is not silently mangled.
COMMANDS="$(
  awk -v key="${TIER}_gate:" '
    # A top-level key is a line starting in column 1 with a non-space,
    # non-comment character. Reaching one ends the section we are in.
    /^[^ \t#]/ {
      if (index($0, key) == 1) { inside = 1; next }
      inside = 0
    }
    !inside { next }
    /^[ \t]*#/ { next }
    /^[ \t]*$/ { next }
    /^[ \t]*-[ \t]*/ {
      line = $0
      sub(/^[ \t]*-[ \t]*/, "", line)
      sub(/[ \t]+$/, "", line)
      if (line == "") next
      first = substr(line, 1, 1); last = substr(line, length(line), 1)
      if ((first == "\"" && last == "\"") || (first == "'\''" && last == "'\''")) {
        if (length(line) >= 2) line = substr(line, 2, length(line) - 2)
      }
      print line
    }
  ' < "$GATES"
)"

if [ -z "$COMMANDS" ]; then
  echo "no $TIER gate declared — ${TIER}_gate in $(basename "$GATES") is empty, so nothing ran"
  exit 0
fi

count="$(printf '%s\n' "$COMMANDS" | wc -l | tr -d ' ')"
echo "running the $TIER gate — $count command(s) from $(basename "$GATES")"

i=0
while IFS= read -r cmd; do
  [ -n "$cmd" ] || continue
  i=$((i + 1))
  echo "  [$i/$count] $cmd"
  # `cd` per command: a command that changes directory must not silently
  # relocate the next one. Stdin from /dev/null: this loop reads its list from
  # stdin, so a command inheriting it would consume the commands after it, and
  # the tier would report them as passed without running them.
  ( cd "$REPO_ROOT" && eval "$cmd" ) </dev/null
  rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "  ✗ the $TIER gate failed at command $i/$count (exit $rc): $cmd" >&2
    exit 1
  fi
done <<EOF
$COMMANDS
EOF

echo "✓ the $TIER gate passed — $count of $count command(s)"
exit 0
