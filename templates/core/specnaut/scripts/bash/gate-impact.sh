#!/usr/bin/env bash
# Decide which of a tier's commands this candidate needs. Called by run-gate.sh, and
# by nothing else:
#
#   gate-impact.sh <tier> <commands-file> <records-file> <--base <rev> | --refs-stdin> <rev or "">
#                  [--head <sha> [--objects <dir>]]   the candidate is that commit (_gate_candidate.sh)
#
# It takes data and returns data. <commands-file> holds the tier's parsed commands,
# one per line; <records-file> receives tab-separated records and a final `end`:
#
#   inactive                 no declaration, here or on a base: run as if bare
#   refused   <cause>        the candidate cannot be vouched for
#   candidate <tree> <commit>
#   base      <commit>       once per base
#   scope     <full|owners|none> <owners or ->
#   fallback  <cause>        why the run widened to full
#   adapter   <command>      the adapter this selection took on trust
#   removed   <command>      in a base's tier, gone from the candidate's
#   run       <owners or -> <command>
#   omit      <reason> <command>
#   end
#
# This file holds every fallback cause and the rule behind them: uncertainty widens.
# What is not shown safe to narrow runs the full tier and names why. It runs nothing
# of the tier itself; a missing `end` is how run-gate.sh knows there is no answer.
# The threat model is mistakes: this runs from the candidate's own scripts, so it
# cannot stop a hostile branch, which already controls gates.yml.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"
# shellcheck source=SCRIPTDIR/common.sh
. "$SCRIPT_DIR/common.sh" || exit 70
# shellcheck source=SCRIPTDIR/_gate_candidate.sh
. "$SCRIPT_DIR/_gate_candidate.sh" || exit 70
# shellcheck source=SCRIPTDIR/_gate_impact_read.sh
. "$SCRIPT_DIR/_gate_impact_read.sh" || exit 70
# shellcheck source=SCRIPTDIR/_gate_impact_adapter.sh
. "$SCRIPT_DIR/_gate_impact_adapter.sh" || exit 70
# shellcheck source=SCRIPTDIR/_gate_impact_graph.sh
. "$SCRIPT_DIR/_gate_impact_graph.sh" || exit 70

for gate_var in $GATE_LOCAL_ENV; do unset "$gate_var"; done

TIER="${1:?}" COMMANDS="${2:?}" RECORDS="${3:?}" MODE="${4:?}" BASE_ARG="${5:-}"
: >"$RECORDS" || exit 70

DECLARATION=.specnaut/impact.json
CAUSE=""
BASES=()       # the commits the change set is computed against
COMPARE=()     # those, and the merge-base with the default branch (FR-006)
LOCAL_SHAS=()  # what a push offers as the candidate
CANDIDATE_TREE="" CANDIDATE_COMMIT="" AFFECTED="" SELECT=0

WORK="$(mktemp -d)" || exit 70
cleanup() { gate_adapter_cleanup; rm -rf "$WORK"; }
trap cleanup EXIT
trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM

record() { local IFS=$'\t'; printf '%s\n' "$*" >>"$RECORDS"; }
widen() { [ -n "$CAUSE" ] || CAUSE="$(gate_ascii "$1")"; }
inactive() { record inactive; record end; exit 0; }
refuse() {
  [ -z "$CANDIDATE_COMMIT" ] || record candidate "$CANDIDATE_TREE" "$CANDIDATE_COMMIT"
  record refused "$(gate_ascii "$1")"
  record end
  exit 0
}

add_base() { case " ${BASES[*]-} " in *" $1 "*) return 0 ;; esac; BASES+=("$1"); COMPARE+=("$1"); }

# FR-005: what a push's lines say is the candidate's reader's; what they mean is here.
read_refs() {
  local fact value
  while read -r fact value; do
    case "$fact" in
      local) LOCAL_SHAS+=("$value") ;;
      base) add_base "$value" ;;
      malformed) widen "refs-malformed: $value" ;;
      zero) widen "remote-zero: $value" ;;
      unfetched) widen "remote-unfetched: $value" ;;
    esac
  done < <(gate_candidate_read_refs)
  [ "${#BASES[@]}" -gt 0 ] || widen "no-base-in-refs"
}

read_base_flag() {
  local commit
  [ -n "$BASE_ARG" ] || { widen "base-empty"; return 0; }
  if commit="$(gate_git rev-parse --verify --quiet --end-of-options "$BASE_ARG^{commit}" 2>/dev/null)"; then
    add_base "$commit"
  else
    widen "base-unresolved: $BASE_ARG"
  fi
}

# FR-006: a narrow base must not launder an earlier change, so the protected paths
# are also compared with where the branch left the default branch.
read_merge_base() {
  local name commit
  name="$(cd -- "$REPO_ROOT" && bash "$SCRIPT_DIR/base-branch.sh" 2>/dev/null)" ||
    { widen "default-branch-unresolved"; return 0; }
  if commit="$(gate_candidate_merge_base "$name")"; then COMPARE+=("$commit"); else widen "merge-base-unresolved: $name"; fi
}

# FR-006, for one path: tracked and regular on every side, and the same on every side.
check_protected() {
  local path="$1" mine theirs commit mine_rc theirs_rc
  mine="$(gate_graph_protected_entries "$CANDIDATE_COMMIT" "$path")"
  mine_rc=$?
  [ "$mine_rc" -ne 2 ] || { widen "protected-not-regular: $path"; return 1; }
  for commit in "${COMPARE[@]}"; do
    theirs="$(gate_graph_protected_entries "$commit" "$path")"
    theirs_rc=$?
    [ "$theirs_rc" -ne 2 ] || { widen "protected-not-regular: $path"; return 1; }
    [ "$mine" = "$theirs" ] || { widen "protected-changed: $path"; return 1; }
  done
  [ "$mine_rc" -eq 0 ] || { widen "protected-not-regular: $path"; return 1; }
}

load_declaration() {
  local problem
  gate_git cat-file blob "$CANDIDATE_COMMIT:$DECLARATION" >"$WORK/impact.json" 2>/dev/null ||
    { widen "declaration-malformed: unreadable"; return 1; }
  problem="$(gate_read_declaration "$WORK/impact.json" "$WORK/declared.json")" ||
    { widen "declaration-malformed: $problem"; return 1; }
  ADAPTER_COMMAND="$(gate_read_adapter_command "$WORK/declared.json")" || { widen "declaration-unreadable: adapter.command"; return 1; }
  gate_read_adapter_files "$WORK/declared.json" >"$WORK/adapter-files" || { widen "declaration-unreadable: adapter.files"; return 1; }
  gate_read_checks "$WORK/declared.json" >"$WORK/checks" || { widen "declaration-unreadable: checks"; return 1; }
}

check_every_protected() {
  local path
  check_protected .specnaut/gates.yml || return 1
  check_protected .specnaut/scripts/ || return 1
  while IFS= read -r path; do
    check_protected "$path" || return 1
  done <"$WORK/adapter-files"
}

# One adapter run: its exit and its output are all a cause needs, and each is one.
snapshot_side() {
  local side="$1" worktree="$2" tree="$3" commit="$4" n="$5" rc problem
  gate_adapter_run "$ADAPTER_COMMAND" "$worktree" "$tree" "$commit" "$WORK/adapter.$n.out"
  rc=$?
  [ "$rc" -eq 0 ] || { widen "adapter-failed: $side exit $rc"; return 1; }
  [ -s "$WORK/adapter.$n.out" ] || { widen "adapter-no-output: $side"; return 1; }
  problem="$(gate_read_snapshot "$WORK/adapter.$n.out" "$commit" "$WORK/snapshot.$n.json")" ||
    { widen "adapter-$problem: $side"; return 1; }
}

# One snapshot per distinct base, plus the candidate's, described by the first base's
# adapter. FR-006 has shown every copy of the adapter to be the same bytes.
take_snapshots() {
  local i=0 commit first=""
  mkdir -p "$WORK/nohooks"
  for commit in "${BASES[@]}"; do
    i=$((i + 1))
    gate_adapter_worktree "$commit" "$WORK/wt.$i" "$WORK/nohooks" ||
      { widen "worktree-failed: $commit"; return 1; }
    [ -n "$first" ] || first="$WORK/wt.$i"
    snapshot_side base "$WORK/wt.$i" "$WORK/wt.$i" "$commit" "$i" || return 1
  done
  snapshot_side candidate "$first" "$REPO_ROOT" "$CANDIDATE_COMMIT" candidate
}

compute_affected() {
  local i=0 commit problem answer unknown
  : >"$WORK/pairs"
  for commit in "${BASES[@]}"; do
    i=$((i + 1))
    problem="$(gate_graph_changes "$commit" "$CANDIDATE_COMMIT" "$WORK/paths.$i")" ||
      { widen "$problem"; return 1; }
    gate_graph_pair "$WORK/paths.$i" "$WORK/snapshot.$i.json" >>"$WORK/pairs" ||
      { widen "graph-failed: pair"; return 1; }
  done
  unknown="$(gate_read_unknown_owner "$WORK/declared.json" "$WORK"/snapshot.*.json)" ||
    { widen "graph-failed: owners"; return 1; }
  [ -z "$unknown" ] || { widen "declaration-malformed: unknown owner $unknown"; return 1; }
  answer="$(gate_graph_affected "$WORK/pairs" "$WORK/snapshot.candidate.json" "$WORK/declared.json")" ||
    { widen "graph-failed: closure"; return 1; }
  case "$answer" in
    full$'\t'*) widen "${answer#full$'\t'}"; return 1 ;;
    owners$'\t'*) AFFECTED="${answer#owners$'\t'}" ;;
    *) widen "graph-failed: answer"; return 1 ;;
  esac
}

# The chain that can narrow a run: the first stage unable to show narrowing safe
# widens and ends it, and only reaching the end sets SELECT.
decide() {
  local drift
  [ -z "$CAUSE" ] || return 0
  command -v jq >/dev/null 2>&1 || { widen "jq-absent"; return 0; }
  gate_read_jq_usable "$COMMANDS" || { widen "jq-unusable"; return 0; }
  check_protected "$DECLARATION" || return 0
  load_declaration || return 0
  case " $(gate_read_scoped_tiers "$WORK/declared.json") " in
    *" $TIER "*) ;;
    *) widen "tier-not-scoped: $TIER"; return 0 ;;
  esac
  check_every_protected || return 0
  [ -z "$EXPLICIT_HEAD" ] || { widen "head-not-checked-out: the adapter describes a work tree"; return 0; }
  take_snapshots || { drift="$(gate_candidate_check "$CANDIDATE_TREE")" || refuse "$drift"; return 0; }
  drift="$(gate_candidate_check "$CANDIDATE_TREE")" || refuse "$drift"
  compute_affected || return 0
  SELECT=1
}

# One command's record. A check naming owners gets those it covers that are affected;
# one naming none covers any. A command with no check always runs, as declared.
select_one() {
  local cmd="$1" gate scoped owners hit o
  while IFS=$'\t' read -r gate scoped owners; do
    [ "$gate" = "$cmd" ] || continue
    hit=""
    for o in $AFFECTED; do
      case " $owners " in " - "|*" $o "*) hit="$hit $o" ;; esac
    done
    if [ -n "$hit" ]; then
      record run "${hit# }" "$scoped"
    elif [ "$owners" = "-" ]; then
      record omit "no-affected-owner" "$cmd"
    else
      record omit "owners-not-affected: $owners" "$cmd"
    fi
    return 0
  done <"$WORK/checks"
  record run - "$cmd"
}

# Commands in a base's tier that the candidate's no longer has. "Full" means the
# candidate's own list, so a branch that drops a command would otherwise pass without
# it. Read through run-gate's parser: a second one would be a second definition.
report_removed() {
  local commit cmd seen=$'\n'
  for commit in ${COMPARE[@]+"${COMPARE[@]}"}; do
    gate_git cat-file blob "$commit:.specnaut/gates.yml" >"$WORK/gates.base" 2>/dev/null || continue
    while IFS= read -r cmd; do
      grep -qxF -- "$cmd" "$COMMANDS" && continue
      case "$seen" in *$'\n'"$cmd"$'\n'*) continue ;; esac
      seen="$seen$cmd"$'\n'
      record removed "$cmd"
    done < <(bash "$SCRIPT_DIR/run-gate.sh" "$TIER" --parse-gates "$WORK/gates.base")
  done
}

write_selection() {
  local commit cmd scope
  record candidate "$CANDIDATE_TREE" "$CANDIDATE_COMMIT"
  for commit in ${BASES[@]+"${BASES[@]}"}; do record base "$commit"; done
  if [ "$SELECT" -eq 1 ]; then
    scope=none
    [ -z "$AFFECTED" ] || scope=owners
    record scope "$scope" "${AFFECTED:--}"
    record adapter "$ADAPTER_COMMAND"
  else
    record scope full -
    record fallback "$CAUSE"
  fi
  report_removed
  while IFS= read -r cmd; do
    if [ "$SELECT" -eq 1 ]; then select_one "$cmd"; else record run - "$cmd"; fi
  done <"$COMMANDS"
  record end
}

main() {
  local refusal in_repo=0
  gate_candidate_head "$@" || refuse "head-refused: $EXPLICIT_REFUSAL"
  gate_candidate_in_repo && in_repo=1
  if [ "$in_repo" -eq 1 ]; then
    case "$MODE" in
      --base) read_base_flag ;;
      --refs-stdin) read_refs ;;
    esac
    read_merge_base
  fi
  gate_candidate_declares "$DECLARATION" ${COMPARE[@]+"${COMPARE[@]}"} || inactive
  [ "$in_repo" -eq 1 ] || refuse "not-a-repository: a declaration needs a work tree to vouch for"
  gate_candidate_capture || refuse "no-commit"
  refusal="$(gate_candidate_check "$CANDIDATE_TREE")" || refuse "$refusal"
  refusal="$(gate_candidate_same_tree ${LOCAL_SHAS[@]+"${LOCAL_SHAS[@]}"})" || refuse "$refusal"
  decide
  write_selection
}

main "${@:6}"
