# shellcheck shell=bash
# Sourced by run-gate.sh, and only behind a flag: the selected run. It asks gate-impact.sh
# which commands this candidate needs, runs that selection through run-gate.sh's
# gate_run_one, and reports what it ran and what it did not. The exit codes are
# run-gate.sh's; which command runs and why is the resolver's to say. Requires TIER, FLAG,
# BASE_VALUE, GATES, SCRIPT_DIR, REPO_ROOT, parse_tier and gate_run_one.

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
# FAILED_RC. The owners go to gate_run_one, which puts them in the one variable named
# for them, never in a command string.
FAILED_AT=0 FAILED_RC=0
run_selection() {
  local i=0 count="${#RUN_COMMANDS[@]}" cmd owners rc shown
  [ "$count" -gt 0 ] || { echo "ran: none"; return 0; }
  while [ "$i" -lt "$count" ]; do
    cmd="${RUN_COMMANDS[$i]}" owners="${RUN_OWNERS[$i]}" shown="$(gate_ascii "${RUN_COMMANDS[$i]}")"
    i=$((i + 1))
    echo "  [$i/$count] $shown"
    gate_run_one "$owners" "$cmd"
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

# Returns only when the answer is `inactive`, for the bare path to run with nothing
# printed. An answer with no final `end` is no answer: it never reads
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
