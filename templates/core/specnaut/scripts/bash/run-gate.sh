#!/usr/bin/env bash
# Run one declared quality-gate tier.
#
#   run-gate.sh <fast|full> [--base <rev> | --refs-stdin]
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

FLAG="" BASE_VALUE=""
flag_usage() { echo "usage: run-gate.sh <fast|full> [--base <rev> | --refs-stdin]" >&2; exit 2; }
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

# The answer gate-impact.sh wrote, one array per kind of record.
TREE="" COMMIT="" SCOPE="" SCOPE_OWNERS="" REFUSED="" CAUSE=""
RUN_OWNERS=() RUN_COMMANDS=() OMITTED=() REMOVED=()
read_records() {
  local kind rest
  while IFS=$'\t' read -r kind rest; do
    case "$kind" in
      candidate) TREE="${rest%%$'\t'*}" COMMIT="${rest#*$'\t'}" ;;
      scope) SCOPE="${rest%%$'\t'*}" SCOPE_OWNERS="${rest#*$'\t'}" ;;
      refused) REFUSED="$rest" ;;
      fallback) CAUSE="$rest" ;;
      removed) REMOVED+=("$rest") ;;
      omit) OMITTED+=("${rest#*$'\t'} (${rest%%$'\t'*})") ;;
      run) RUN_OWNERS+=("${rest%%$'\t'*}") RUN_COMMANDS+=("${rest#*$'\t'}") ;;
    esac
  done <"$1"
}

# Every activated run prints every label, `none` where there is nothing to say: a
# line missing from a report cannot be told from a report that was cut short.
report_label() {
  local label="$1" item
  shift
  [ "$#" -gt 0 ] || { echo "$label: none"; return 0; }
  for item in "$@"; do echo "$label: $(gate_ascii "$item")"; done
}

print_report_head() {
  if [ -n "$TREE" ]; then echo "candidate: tree=$TREE commit=$COMMIT"; else echo "candidate: unknown"; fi
  case "$SCOPE" in
    owners) echo "scope: owners $SCOPE_OWNERS" ;;
    "") echo "scope: none" ;;
    *) echo "scope: $SCOPE" ;;
  esac
  if [ -n "$CAUSE" ]; then echo "fallback: $CAUSE"; else echo "fallback: none"; fi
  report_label removed ${REMOVED[@]+"${REMOVED[@]}"}
  report_label omitted ${OMITTED[@]+"${OMITTED[@]}"}
}

# Exit 3 before anything ran. A refusal still prints the whole report, so a caller
# reads one shape; there is no result to record, so no evidence is written.
refuse_candidate() {
  local label
  echo "candidate: refused ($1)"
  for label in scope fallback removed omitted ran; do echo "$label: none"; done
  echo "evidence: unwritten (candidate refused)"
  echo "the $TIER gate refused the candidate: $1" >&2
  exit 3
}

# Runs the selection in order and stops at the first failure. Sets FAILED_AT and
# FAILED_RC. Stdin from /dev/null, and the owners in the one variable named for them,
# never spliced into a command string; no owners means none is inherited either.
FAILED_AT=0 FAILED_RC=0
run_selection() {
  local i=0 count="${#RUN_COMMANDS[@]}" cmd owners rc shown
  [ "$count" -gt 0 ] || { echo "ran: none"; return 0; }
  while [ "$i" -lt "$count" ]; do
    cmd="${RUN_COMMANDS[$i]}" owners="${RUN_OWNERS[$i]}" shown="$(gate_ascii "${RUN_COMMANDS[$i]}")"
    i=$((i + 1))
    echo "  [$i/$count] $shown"
    (
      cd "$REPO_ROOT" || exit 125
      if [ "$owners" = "-" ]; then unset SPECNAUT_AFFECTED_OWNERS; else export SPECNAUT_AFFECTED_OWNERS="$owners"; fi
      eval "$cmd"
    ) </dev/null
    rc=$?
    printf '%s\t%s\t%s\n' "$rc" "$owners" "$cmd" >>"$WORK/ran"
    if [ "$owners" = "-" ]; then echo "ran: $shown (exit $rc)"; else echo "ran: $shown (owners $owners; exit $rc)"; fi
    if [ "$rc" -ne 0 ]; then
      FAILED_AT="$i" FAILED_RC="$rc"
      return 0
    fi
  done
}

# FR-013: a failed command stops at 1, whatever else is true. Drift after commands
# that passed is 3, and drift of any kind invalidates the evidence. Omitted commands
# with nothing run, or a tier emptied on the branch, is 4: nothing was checked.
conclude_selected() {
  local count="${#RUN_COMMANDS[@]}" result=passed valid=true code=0 drift="" outcome="" where
  if [ "$FAILED_AT" -ne 0 ]; then
    result=failed code=1
    outcome="the $TIER gate failed at command $FAILED_AT/$count (exit $FAILED_RC)"
  elif [ "$count" -eq 0 ] && [ "$((${#OMITTED[@]} + ${#REMOVED[@]}))" -gt 0 ]; then
    result=skipped code=4
    outcome="the $TIER gate ran nothing: every command was omitted or removed, and a skip is not a pass"
  elif [ "$count" -eq 0 ]; then
    result=undeclared
    outcome="no $TIER gate declared, so nothing ran"
  else
    outcome="the $TIER gate passed (scope: $SCOPE) - $count command(s) ran, ${#OMITTED[@]} omitted"
    [ "$SCOPE" != owners ] || outcome="the $TIER gate passed (scope: owners $SCOPE_OWNERS) - $count command(s) ran, ${#OMITTED[@]} omitted"
  fi
  if ! drift="$(gate_candidate_check "$TREE")"; then
    valid=false
    if [ "$code" -eq 0 ]; then
      result=invalid code=3
      outcome="the $TIER gate refused the candidate after running: $drift"
    fi
  fi
  where="$(gate_evidence_write "$TIER" "$TREE" "$WORK/records" "$WORK/ran" "$result" "$valid")"
  echo "evidence: $(gate_ascii "$where")"
  if [ "$code" -eq 0 ]; then echo "$outcome"; else echo "$outcome" >&2; fi
  exit "$code"
}

# Behind a flag. Returns only when the answer is `inactive`, for the bare path to run
# with nothing printed. An answer with no final `end` is no answer: it never reads
# as a pass, and whether to widen is not this file's to decide.
run_selected() {
  local rc=0
  WORK="$(mktemp -d)" || { echo "run-gate: no temporary directory" >&2; exit 3; }
  trap 'rm -rf "$WORK"' EXIT
  : >"$WORK/commands"
  : >"$WORK/ran"
  if [ -r "$GATES" ]; then parse_tier "$GATES" >"$WORK/commands"; fi
  bash "$SCRIPT_DIR/gate-impact.sh" "$TIER" "$WORK/commands" "$WORK/records" "$FLAG" "$BASE_VALUE" || rc=$?
  [ "$(head -n 1 "$WORK/records" 2>/dev/null)" != inactive ] || return 0
  # shellcheck source=SCRIPTDIR/_gate_candidate.sh
  . "$SCRIPT_DIR/_gate_candidate.sh" || { echo "run-gate: _gate_candidate.sh is missing" >&2; exit 3; }
  # shellcheck source=SCRIPTDIR/common.sh
  . "$SCRIPT_DIR/common.sh" || { echo "run-gate: common.sh is missing" >&2; exit 3; }
  # shellcheck source=SCRIPTDIR/_gate_evidence.sh
  . "$SCRIPT_DIR/_gate_evidence.sh" || { echo "run-gate: _gate_evidence.sh is missing" >&2; exit 3; }
  [ "$(tail -n 1 "$WORK/records" 2>/dev/null)" = end ] || refuse_candidate "no-selection: gate-impact exit $rc"
  read_records "$WORK/records"
  [ -z "$REFUSED" ] || refuse_candidate "$REFUSED"
  print_report_head
  run_selection
  conclude_selected
}

if [ -n "$FLAG" ]; then run_selected; fi

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
