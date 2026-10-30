# shellcheck shell=bash
# Sourced by approve-on-prompt.sh after _approval.sh and _paths.sh, and by
# guard-merge.sh after _approval.sh for what the prompt found of the landing
# hold (cli#718) — it calls none of the file functions. The
# writer-agnostic backstop behind protect-constitution.sh (spec 038 § 11 S1):
# the PreToolUse guard reads commands, and no reading of a command sees every
# writer — an interpreter, a script, a formatter, `git checkout`. So the user's
# prompt fingerprints the four project-owned files, and Stop compares.
#
# It does the same for the merge mode (cli#718): merge-mode.sh --strict reads
# copies of workflow.yml from refs a model can move (`git update-ref`), so the
# mode the prompt found is kept beside the sums. guard-merge holds a turn
# that began on manual for the whole turn, and Stop asks about a turn that
# ended on auto when it began on manual, unless the turn approved `merge` or
# `gate-config`.
#
# A file that changed during the turn with no approval of its kind blocks the
# stop with a question for the user, and the version from the start of the
# turn is kept. It is never restored: the change may be the user's own, made
# in their editor while the agent worked.
#
# Kept under ${XDG_STATE_HOME:-$HOME/.local/state}/specnaut/, beside the
# stamps and outside the workspace for the same reason (spec 036 § 11 F3):
#   baselines/<sha256(GUARD_ROOT)>/<session_id>/ sums, and a copy of each file
#   kept/<sha256(GUARD_ROOT)>/                   the copies a blocked stop kept

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
  baseline_mode >"$1/mode"
}

# baseline_check <dir> <approved kinds, space-separated> <stop_hook_active> —
# prints a Stop `block` decision when a file changed with no approval of its
# kind; nothing otherwise. Any difference re-baselines, approved or not, so a
# turn the stop continues is judged from here and never asked about twice.
baseline_check() {
  local i sum f kept keepdir ts seen=0
  local -a changed=()
  [ -f "$1/sums" ] || return 0 # no prompt fingerprinted this session yet
  if [ "$(cat "$1/mode" 2>/dev/null)" = manual ] && sum=$(baseline_mode) && [ "$sum" != manual ]; then
    seen=1
    case " $2 " in
      *" merge "* | *" gate-config "*) ;;
      *) changed+=("the merge mode (manual when the turn began, $sum now: a copy of .specnaut/workflow.yml, or a ref it is read from, was rewritten)") ;;
    esac
  fi
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
      # Git Bash on Windows: name the copy as the agent's own tools can open it.
      if command -v cygpath >/dev/null 2>&1; then kept=$(cygpath -w "$kept"); fi
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

# The base branch as the user's prompts found it (cli#718). base-branch.sh
# reads origin/HEAD, which one `git remote set-head` repoints: the landing
# guard would then judge a push to the real base as a push elsewhere, and
# read merge-mode from a copy the model wrote. So each prompt keeps the name
# it resolves, per project, and guard-merge holds every kept name beside the
# base as it resolves now. A kept name is never dropped: a pin only tightens.
#   bases/<sha256(GUARD_ROOT)>/pinned   one name per line

# baseline_mode — the merge mode as the landing guard reads it for this
# project: merge-mode.sh --strict, every pinned base read too. Manual when it
# cannot be read.
baseline_mode() {
  local n m
  local -a a=()
  baseline_bases
  for n in ${PINNED_BASES[@]+"${PINNED_BASES[@]}"}; do a+=(--base "$n"); done
  m=$(cd "$GUARD_ROOT" && bash .specnaut/scripts/bash/merge-mode.sh --strict ${a[@]+"${a[@]}"} 2>/dev/null) || m=manual
  [ "$m" = auto ] || m=manual
  printf '%s\n' "$m"
}

# baseline_pin_base — keep the base as it resolves now, unless it is kept
# already. An unknown base is kept as `?`: until a prompt finds a name, the
# guard treats the base as unknown whatever base-branch.sh prints later, so a
# base the model creates mid-turn holds nothing.
baseline_pin_base() {
  local f b n
  if ! b=$(cd "$GUARD_ROOT" && bash .specnaut/scripts/bash/base-branch.sh 2>/dev/null); then b='?'; fi
  baseline_bases
  if [ "$b" = '?' ] && [ "$PINNED_UNKNOWN" = 1 ]; then return 0; fi
  for n in ${PINNED_BASES[@]+"${PINNED_BASES[@]}"}; do
    if guard_ieq "$n" "$b"; then return 0; fi
  done
  f=$(approval_state bases pinned) # per project: `pinned` stands where a session id would
  mkdir -p "${f%/*}"
  chmod 700 "${f%/*}"
  printf '%s\n' "$b" >>"$f"
}

# baseline_bases — PINNED_BASES: this project's kept names that are plain
# branch names, by base-branch.sh's own test; PINNED_UNKNOWN=1 when a prompt
# found no base. Any other line is skipped.
baseline_bases() {
  local f n
  PINNED_BASES=() PINNED_UNKNOWN=0
  f=$(approval_state bases pinned)
  [ -f "$f" ] || return 0
  while IFS= read -r n || [ -n "$n" ]; do
    n=${n%$'\r'}
    if [ "$n" = '?' ]; then PINNED_UNKNOWN=1
    elif [[ $n =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] && [[ $n != *..* ]]; then PINNED_BASES+=("$n"); fi
  done <"$f"
}
