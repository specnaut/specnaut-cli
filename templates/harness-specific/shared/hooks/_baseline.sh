# shellcheck shell=bash
# Sourced by approve-on-prompt.sh after _approval.sh and _paths.sh. The
# writer-agnostic backstop behind protect-constitution.sh (spec 038 § 11 S1):
# the PreToolUse guard reads commands, and no reading of a command sees every
# writer — an interpreter, a script, a formatter, `git checkout`. So the user's
# prompt fingerprints the four project-owned files, and Stop compares.
#
# A file that changed during the turn with no approval of its kind blocks the
# stop with a question for the user, and the version from the start of the
# turn is kept. It is never restored: the change may be the user's own, made
# in their editor while the agent worked.
#
# Kept under ${XDG_STATE_HOME:-$HOME/.local/state}/specnaut/, beside the
# stamps and outside the workspace for the same reason (spec 036 § 11 F3):
#   baselines/<sha256(toplevel)>/<session_id>/  sums, and a copy of each file
#   kept/<sha256(toplevel)>/                    the copies a blocked stop kept

# _baseline_lists — the files, and the approval kind each one needs.
_baseline_lists() {
  BL_FILES=("$PATHS_CONSTITUTION" "${PATHS_GATE_CONFIGS[@]}")
  BL_KINDS=(constitution)
  local _
  for _ in "${PATHS_GATE_CONFIGS[@]}"; do BL_KINDS+=(gate-config); done
}

# _baseline_sum <file> — its SHA-256, or `-` when it is not a regular file.
_baseline_sum() {
  if [ -f "$1" ]; then approval_sha256 <"$1"; else printf -- -; fi
}

# baseline_snapshot <dir> — fingerprint and copy the files as they are now.
baseline_snapshot() {
  local i f sums=""
  _baseline_lists
  rm -rf "$1"
  mkdir -p "$1"
  chmod 700 "${1%/*}"
  for i in "${!BL_FILES[@]}"; do
    f="$GUARD_ROOT/${BL_FILES[i]}"
    sums+="$i $(_baseline_sum "$f")"$'\n'
    if [ -f "$f" ]; then cp "$f" "$1/$i"; fi
  done
  printf '%s' "$sums" >"$1/sums"
}

# baseline_check <dir> <approved kinds, space-separated> <stop_hook_active> —
# prints a Stop `block` decision when a file changed with no approval of its
# kind; nothing otherwise. Any difference re-baselines, approved or not, so a
# turn the stop continues is judged from here and never asked about twice.
baseline_check() {
  local i sum f kept keepdir ts seen=0
  local -a changed=()
  [ -f "$1/sums" ] || return 0 # no prompt fingerprinted this session yet
  _baseline_lists
  while read -r i sum; do
    f="$GUARD_ROOT/${BL_FILES[i]}"
    [ "$(_baseline_sum "$f")" != "$sum" ] || continue
    seen=1
    case " $2 " in *" ${BL_KINDS[i]} "*) continue ;; esac
    if [ -f "$1/$i" ]; then
      keepdir=${1%/*}                                 # …/specnaut/baselines/<hash>
      keepdir=${keepdir%/*/*}/kept/${keepdir##*/}     # …/specnaut/kept/<hash>
      mkdir -p "$keepdir"
      ts=$(date -u +%Y%m%dT%H%M%SZ)
      kept="$keepdir/$ts-${BL_FILES[i]##*/}"
      cp "$1/$i" "$kept"
      changed+=("${BL_FILES[i]} (its version from the start of the turn is kept at $kept)")
    else
      changed+=("${BL_FILES[i]} (it did not exist when the turn began)")
    fi
  done <"$1/sums"
  [ "$seen" = 0 ] || baseline_snapshot "$1"
  [ ${#changed[@]} -gt 0 ] || return 0
  local r
  r="Specnaut: $(IFS=';'; echo "${changed[*]}") changed during this turn, and the user's prompt did not approve it. Nothing was restored. Before you stop, ask the user one question: keep this change, or restore the kept version? Do not touch the file again until they answer."
  if [ "$3" = true ]; then
    printf '%s\n' "$r" >&2 # a stop this hook already continued: never loop
    return 0
  fi
  jq -cn --arg r "$r" '{decision: "block", reason: $r}'
}
