# shellcheck shell=bash
# Sourced by run-gate.sh behind --sandbox: the tier's commands, read from this checkout's
# own gates.yml, run on the exported copy of a head commit through `specnaut sandbox exec`,
# never in this shell. Requires TIER, EVIDENCE, HEAD_ARGS and _gate_selected.sh.
#
# A command's output goes to a new file in a folder made under the evidence folder, and
# its result is its exit code alone, never read from that output. 125 is the sandbox
# saying nothing ran (no backend, no export, a refused layout): the tier stops there and
# exits 125, NOT RUN, which is never a pass. No owners reach a sandboxed command: a head
# is always run in full (gate-impact.sh runs no adapter on a head).

GATE_LOGS="" GATE_RUNS=0

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

# gate_not_run <i/count> - the sandbox ran nothing at that command: stop, NOT RUN.
gate_not_run() {
  echo "the $TIER gate did not run at command $1: the sandbox ran nothing (exit 125), and a gate that did not run is NOT RUN, never a pass" >&2
  exit 125
}
