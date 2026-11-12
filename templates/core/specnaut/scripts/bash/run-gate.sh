#!/usr/bin/env bash
# Run one declared quality-gate tier.
#
#   run-gate.sh <fast|full> [--base <rev> | --refs-stdin]
#               [--head <sha> [--objects <dir>] --evidence <dir> --sandbox]
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
#   3   behind a flag: the candidate is refused, before or after the commands
#   4   behind a flag: every command was omitted, or the tier was emptied on the
#       branch. A skip is never a pass
#   125 behind --sandbox: the sandbox ran nothing, so the tier is NOT RUN, never a pass
#
# --sandbox runs each command on the exported copy of the head commit <sha> through
# `specnaut sandbox exec` (_gate_sandbox.sh), its output to a new file under the
# --evidence folder, judged by its exit code alone. --head and --objects are only for it,
# and reach gate-impact.sh as given; the evidence goes to that folder.
#
# Bare, it never reads `.specnaut/impact.json` and is the manual full override.
# Behind a flag it asks gate-impact.sh which commands this candidate needs, runs
# that selection with its own loop and reports what it ran and what it did not. With
# no declaration on either side the flag changes nothing, to the byte. Which
# command runs and why is the resolver's to say; what the outcome exits is this
# file's. `--parse-gates <file>` prints a tier's commands from <file>: it is how the
# resolver reads a base's list without a second parser.
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

# Read one flat list. The format is narrow on purpose (see gates.yml): a
# top-level `<tier>_gate:` key, then `  - ` items until the next top-level key.
# Quotes around an item are optional and are stripped as a matched pair only,
# so a command containing a quote is not silently mangled.
parse_tier() {
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
  ' < "$1"
}

FLAG="" BASE_VALUE="" EVIDENCE="" SANDBOX=0 HEAD_ARGS=()
flag_usage() {
  [ -z "${1:-}" ] || echo "run-gate: $1" >&2
  echo "usage: run-gate.sh <fast|full> [--base <rev> | --refs-stdin] [--head <sha> [--objects <dir>] --evidence <dir> --sandbox]" >&2
  exit 2
}
parse_flags() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --base)
        if [ -n "$FLAG" ] || [ "$#" -lt 2 ]; then flag_usage; fi
        case "$2" in -*) flag_usage ;; esac
        FLAG=--base BASE_VALUE="$2"
        shift 2
        ;;
      --refs-stdin)
        [ -z "$FLAG" ] || flag_usage
        FLAG=--refs-stdin
        shift
        ;;
      --head | --objects)
        [ "$#" -ge 2 ] || flag_usage "$1 takes a value"
        HEAD_ARGS+=("$1" "$2")
        shift 2
        ;;
      --evidence)
        [ "$#" -ge 2 ] && [ -n "$2" ] || flag_usage "--evidence takes a value"
        EVIDENCE="$2"
        shift 2
        ;;
      --sandbox) SANDBOX=1 && shift ;;
      --parse-gates)
        [ "$#" -eq 2 ] || flag_usage
        parse_tier "$2"
        exit 0
        ;;
      *) flag_usage ;;
    esac
  done
}
parse_flags "${@:2}"
[ "${#HEAD_ARGS[@]}" -eq 0 ] || [ "$SANDBOX" = 1 ] || flag_usage "--head and --objects need --sandbox"

# gate_run_one <owners or -> <command> - the one place a command of the tier is run:
# from the repository root, stdin from /dev/null, and the owners in the one variable
# named for them, never spliced into the command string; `-` means no owners, and that
# none is inherited either.
gate_run_one() {
  local owners="$1" cmd="$2"
  shift 2
  [ "$SANDBOX" = 0 ] || { gate_run_sandboxed "$cmd"; return; }
  (
    cd "$REPO_ROOT" || exit 125
    if [ "$owners" = "-" ]; then unset SPECNAUT_AFFECTED_OWNERS; else export SPECNAUT_AFFECTED_OWNERS="$owners"; fi
    eval "$cmd"
  ) </dev/null
}

# Behind a flag, the selected run (_gate_selected.sh) exits with its own report, or
# returns when gate-impact.sh answers `inactive`, for the bare path below.
if [ -n "$FLAG" ] || [ "$SANDBOX" = 1 ]; then
  # shellcheck source=SCRIPTDIR/_gate_selected.sh
  . "$SCRIPT_DIR/_gate_selected.sh" || { echo "run-gate: _gate_selected.sh is missing" >&2; exit 3; }
  # shellcheck source=SCRIPTDIR/_gate_sandbox.sh
  . "$SCRIPT_DIR/_gate_sandbox.sh" || { echo "run-gate: _gate_sandbox.sh is missing" >&2; exit 3; }
fi
[ "$SANDBOX" = 0 ] || gate_sandbox_start
[ -z "$FLAG" ] || run_selected

if [ ! -r "$GATES" ]; then
  echo "no $TIER gate declared — $GATES is absent, so nothing ran"
  exit 0
fi

COMMANDS="$(parse_tier "$GATES")"

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
  if [ "$SANDBOX" = 1 ]; then gate_run_sandboxed "$cmd"; else ( cd "$REPO_ROOT" && eval "$cmd" ) </dev/null; fi
  rc=$?
  [ "$SANDBOX" = 0 ] || [ "$rc" -ne 125 ] || gate_not_run "$i/$count"
  if [ "$rc" -ne 0 ]; then
    echo "  ✗ the $TIER gate failed at command $i/$count (exit $rc): $cmd" >&2
    exit 1
  fi
done <<EOF
$COMMANDS
EOF

echo "✓ the $TIER gate passed — $count of $count command(s)"
exit 0
