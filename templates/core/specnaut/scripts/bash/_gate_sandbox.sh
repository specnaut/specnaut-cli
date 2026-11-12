# shellcheck shell=bash
# Sourced by run-gate.sh behind --sandbox: the tier's commands, read from this checkout's
# own gates.yml, run on the exported copy of a head commit through `specnaut sandbox exec`,
# never in this shell. Sourced before the options are read; gate_sandbox_start requires
# TIER and _gate_selected.sh.
#
# A command's output goes to a new file in a folder made under the evidence folder, and
# its result is its exit code alone, never read from that output. 125 is the sandbox
# saying nothing ran (no backend, no export, a refused layout), 127 a command not found
# on the sandbox's PATH: nothing of the branch ran either way, so the tier stops there
# and exits 125, NOT RUN, which is never a pass. No owners reach a sandboxed command: a head
# is always run in full (gate-impact.sh runs no adapter on a head).

# shellcheck disable=SC2034 # GATE_WORDS is read by run-gate.sh's option loop
GATE_LOGS="" GATE_RUNS=0 GATE_WORDS=0 EVIDENCE="" SANDBOX=0 HEAD_ARGS=()

# gate_sandbox_option <option> [<value>...] - takes --head, --objects, --evidence or
# --sandbox, any other option being a usage error, and sets GATE_WORDS to how many words
# it used. A value is never empty and never starts with `-`, as --base's. The head is
# parsed once, later, by _explicit_head.sh.
gate_sandbox_option() {
  case "$1" in --head | --objects | --evidence | --sandbox) ;; *) flag_usage ;; esac
  GATE_WORDS=1
  [ "$1" != --sandbox ] || { SANDBOX=1 && return 0; }
  [ "$#" -ge 2 ] && [ -n "$2" ] || flag_usage "$1 takes a value"
  case "$2" in -*) flag_usage "$1 takes a value, not $2" ;; esac
  GATE_WORDS=2
  if [ "$1" = --evidence ]; then EVIDENCE="$2"; else HEAD_ARGS+=("$1" "$2"); fi
}

# gate_sandbox_options_hold - the head and the evidence folder are only for a sandboxed
# run: a pass on the work tree must never speak for a commit it did not run.
gate_sandbox_options_hold() {
  [ "$SANDBOX" = 1 ] || { [ "${#HEAD_ARGS[@]}" -eq 0 ] && [ -z "$EVIDENCE" ]; } ||
    flag_usage "--head, --objects and --evidence need --sandbox"
}

# gate_none_declared - after "no gate declared": bare, that is exit 0; in a sandbox nothing
# of the branch ran, which is NOT RUN, never a pass.
gate_none_declared() {
  [ "$SANDBOX" = 1 ] || exit 0
  echo "the $TIER gate did not run: none is declared, and a gate that did not run is NOT RUN, never a pass" >&2
  exit 125
}

# gate_sandbox_start - takes the head and makes the log folder, or stops: exit 2 for an
# evidence folder or option missing or misplaced, 3 for a head refused.
gate_sandbox_start() {
  [ -n "$EVIDENCE" ] || flag_usage "--sandbox needs --evidence <dir>"
  case "$EVIDENCE" in /* | [A-Za-z]:[/\\]*) ;; *) flag_usage "--evidence takes an absolute folder" ;; esac
  [ "${#HEAD_ARGS[@]}" -gt 0 ] || flag_usage "--sandbox needs --head <sha>"
  gate_helpers
  gate_candidate_head "${HEAD_ARGS[@]}" || refuse_candidate "head-refused: $EXPLICIT_REFUSAL"
  gate_evidence_apart "$EVIDENCE" || flag_usage "--evidence lies inside the head's repository"
  GATE_LOGS="$(mktemp -d "$EVIDENCE/gate-$TIER.XXXXXX" 2>/dev/null)" ||
    flag_usage "--evidence names no folder a log can be made in"
}

# gate_run_sandboxed <command> - runs it on the head in the sandbox, its output to the
# next log file, and returns its exit code. Prints where the log is.
gate_run_sandboxed() {
  local log
  GATE_RUNS=$((GATE_RUNS + 1))
  log="$GATE_LOGS/$GATE_RUNS.log"
  echo "log: $(gate_ascii "$log")"
  (
    cd "$REPO_ROOT" || exit 125
    exec specnaut sandbox exec "$EXPLICIT_HEAD" --log "$log" -- sh -c "$1"
  ) </dev/null
}

# gate_sandbox_not_run <rc> - true when, in a sandbox, <rc> says nothing of the branch ran.
gate_sandbox_not_run() { [ "$SANDBOX" = 1 ] && { [ "$1" -eq 125 ] || [ "$1" -eq 127 ]; }; }

# gate_not_run_line <i/count> <rc> <command> - the line that says so, naming the command.
gate_not_run_line() {
  local why="the sandbox ran nothing"
  [ "$2" -ne 127 ] || why="it was not found on the sandbox's PATH"
  echo "the $TIER gate did not run at command $1 (exit $2): $(gate_ascii "$3") - $why, and a gate that did not run is NOT RUN, never a pass"
}

# gate_not_run <i/count> <rc> <command> - stop the bare run there, NOT RUN.
gate_not_run() {
  gate_not_run_line "$@" >&2
  exit 125
}
