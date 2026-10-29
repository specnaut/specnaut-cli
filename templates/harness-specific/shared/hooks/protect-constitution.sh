#!/usr/bin/env bash
# PreToolUse(Edit|Write|MultiEdit|NotebookEdit and Bash on Claude; Edit|Write
# and Bash on Codex) — the one home of "what may write the project's
# constitution and its gate configs" (spec 038, plan § 5, FR-012). Guarded,
# each by the approval kind its phrase mints (S2):
#
#   docs/constitution.md                       constitution
#   .specnaut/{size-limits,boundaries,ui}.yml  gate-config
#   .specnaut/hooks/**                         constitution — this guard and
#                                              what it sources; protect-generated
#                                              gates the same folder under merge
#
# A write needs THIS turn's approval of its kind (approval_require): no stamp
# denies on every harness and in every mode.
#
# The Bash arm (S1) reads each simple command _command.sh cuts out of the line.
# One goes through untouched only when it is a bare read: the command word
# exactly `cat head tail grep wc diff`, or `git diff|log|show|blame|status|add`
# with no option before the subcommand (so no -c) and none of --output*,
# --ext-diff, --textconv, add -e/-p/-i; no `/` in it, no VAR= prefix, and
# nothing on the line that redefines a command (a function, an alias, hash,
# source, a PATH/GIT_* assignment). Any other
# command is judged by the words it carries: a word names a guarded file by
# identity (_paths.sh), by carrying its basename, or — unexpanded `$`, glob or
# brace — by a pattern that could expand to it, case ignored. A redirection
# onto a guarded file is judged whatever the command. An opaque form (eval,
# sh -c, an interpreter's -c/-e, a line it cannot read) is judged by text: it
# names a guarded file when the line mentions one. A commit message or branch
# name that says "constitution" names nothing. What no reading sees — a script,
# a formatter, `git checkout .` — the Stop backstop in _baseline.sh catches.
#
# Usage: protect-constitution.sh <claude|codex>   (payload on stdin)
case ${BASH_SOURCE[0]} in */*) HOOK_DIR=${BASH_SOURCE[0]%/*} ;; *) HOOK_DIR=. ;; esac
# shellcheck source=_guard.sh
. "$HOOK_DIR/_guard.sh" || { echo "specnaut: $HOOK_DIR/_guard.sh is missing — refusing" >&2; exit 2; }
# shellcheck source=_approval.sh
. "$HOOK_DIR/_approval.sh"
# shellcheck source=_paths.sh
. "$HOOK_DIR/_paths.sh" || guard_fail "_paths.sh is missing beside protect-constitution.sh"
# shellcheck source=_command.sh
. "$HOOK_DIR/_command.sh"
guard_init protect-constitution "${1:-}" .tool_input.file_path .tool_input.notebook_path \
  lines:.tool_input.command argv:.tool_input.command
guard_root

# The guarded entries: path, kind, and how a pattern may name it (the files a
# glob or `$` could expand to — for the hooks folder, the scripts it holds).
PC_HOOKS=.specnaut/hooks
PC_PATHS=("$PATHS_CONSTITUTION" "${PATHS_GATE_CONFIGS[@]}" "$PC_HOOKS")
PC_KINDS=(constitution)
for _ in "${PATHS_GATE_CONFIGS[@]}"; do PC_KINDS+=(gate-config); done
PC_KINDS+=(constitution)
PC_LAST=$((${#PC_PATHS[@]} - 1))
PC_SELF=(protect-constitution.sh _paths.sh _guard.sh _approval.sh _command.sh _simple.sh
  _baseline.sh approve-on-prompt.sh)

# PC_BASE_RE[i] — entry i's basename (the folder's path) as a whole token;
# PC_STEM_RE[i] — its stem, which is all an opaque string has to mention.
PC_BASE_RE=() PC_STEM_RE=() PC_LEAF_RE=""
for i in "${!PC_PATHS[@]}"; do
  b=${PC_PATHS[i]##*/}
  paths_ere_to s "$b"
  PC_LEAF_RE+="${PC_LEAF_RE:+|}$s"
  if [ "$i" = "$PC_LAST" ]; then b=$PC_HOOKS; fi
  s=${b%.*}
  if [ "${#s}" -lt 5 ]; then s=$b; fi
  paths_ere_to b "$b"
  paths_ere_to s "$s"
  PC_BASE_RE+=("(^|[^A-Za-z0-9_.-])$b(/|[^A-Za-z0-9_.-]|\$)") PC_STEM_RE+=("$s")
done
PC_LEAF_RE="^($PC_LEAF_RE)\$"

# PC_FORMS / PC_FORM_OF — each spelling a pattern is tried against, and its entry.
PC_FORMS=() PC_FORM_OF=()
_pc_form() { local r; paths_rel_to r "$2"; PC_FORMS+=("$GUARD_ROOT/$2") PC_FORM_OF+=("$1"); if [ -n "$r" ]; then PC_FORMS+=("$r" "./$r") PC_FORM_OF+=("$1" "$1"); fi; }
for i in "${!PC_PATHS[@]}"; do
  if [ "$i" = "$PC_LAST" ]; then
    _pc_form "$i" "$PC_HOOKS"
    for f in "${PC_SELF[@]}"; do _pc_form "$i" "$PC_HOOKS/$f"; done
  else _pc_form "$i" "${PC_PATHS[i]}"; fi
done

PC_NEED="" PC_WHAT=()
# _pc_need <entry> <how it was named>
_pc_need() {
  case " $PC_NEED " in *" ${PC_KINDS[$1]} "*) ;; *) PC_NEED+=" ${PC_KINDS[$1]}" ;; esac
  PC_WHAT+=("${PC_PATHS[$1]}${2:+ ($2)}")
}

# _pc_identity <path> <how> — record each entry <path> is, by identity. A
# word with no separator that names nothing on disk can only be an entry whose
# last component it is — unless the cwd is inside the hooks folder: every other
# one skips the walk (most words of a line).
PC_SKIP=1
if paths_names "$GUARD_CWD" "$PC_HOOKS" under; then PC_SKIP=0; fi
_pc_identity() {
  local t i
  if [ "$PC_SKIP" = 1 ] && [[ $1 != */* && $1 != *\\* ]] && [ ! -e "$GUARD_CWD/$1" ] \
    && [ ! -L "$GUARD_CWD/$1" ] && ! paths_imatch "$1" "$PC_LEAF_RE"; then return 0; fi
  paths_norm_to t "$1"
  for i in "${!PC_PATHS[@]}"; do
    if [ "$i" = "$PC_LAST" ]; then
      if paths_names "$t" "$PC_HOOKS" under; then _pc_need "$i" "$2"; fi
    elif paths_names "$t" "${PC_PATHS[i]}"; then _pc_need "$i" "$2"; fi
  done
}

# _pc_names <word> <how> — record each entry a word of a command names: by its
# basename, by a pattern that could expand to it, or by identity. A word
# holding `=` (an assignment, `--file=…`, dd's `of=…`) is read after it too.
_pc_names() {
  local c i
  local -a cands=("$1")
  [ -n "$1" ] || return 0
  case $1 in *=*) cands+=("${1#*=}") ;; esac
  for i in "${!PC_PATHS[@]}"; do
    if paths_imatch "$1" "${PC_BASE_RE[i]}"; then _pc_need "$i" "$2"; fi
  done
  for c in "${cands[@]}"; do
    if paths_pattern "$c"; then
      if [ "$PATHS_LIT" = 1 ]; then
        for i in "${!PC_FORMS[@]}"; do
          if paths_imatch "${PC_FORMS[i]}" "$PATHS_RE"; then _pc_need "${PC_FORM_OF[i]}" "$2"; fi
        done
      else # nothing but expansions: it names what the line itself mentions
        for i in "${!PC_PATHS[@]}"; do
          if paths_imatch "$PC_LINE" "${PC_BASE_RE[i]}"; then _pc_need "$i" "$2, which the line may set to it"; fi
        done
      fi
    elif [ -n "$c" ] && [[ $c != -* ]]; then
      # shellcheck disable=SC2088 # the literal ~ the shell would expand
      if [ "${c:0:2}" = "~/" ]; then c="$HOME/${c:2}"; fi
      _pc_identity "$c" "$2"
    fi
  done
}

# Per simple command, from _cmd_emit (CMD_ON_SEG): the raw words, and the words
# without redirections with the index of the command word.
PC_RAW=() PC_V=() PC_K=() PC_REDEFINES=0
# shellcheck disable=SC2329 # called through CMD_ON_SEG
_pc_seg() {
  local x IFS=$CMD_SEP
  PC_RAW+=("$1") PC_K+=("$k")
  PC_V+=("${v[*]+"${v[*]}"}")
  for x in ${v[@]+"${v[@]}"}; do
    case $x in PATH=* | BASH_ENV=* | ENV=* | GIT_*=* | LD_*=* | DYLD_*=*) PC_REDEFINES=1 ;; esac
  done
  case ${v[k]:-} in function | alias | hash | enable | source | . | builtin) PC_REDEFINES=1 ;; esac
}

# _pc_read_only — W (from k) is a bare allowlisted read (see the header).
_pc_read_only() {
  local j sub w
  [ "$PC_REDEFINES" = 0 ] || return 1
  for ((j = 0; j < K; j++)); do
    case ${W[j]} in '{' | '}' | '!' | if | then | else | elif | do | while | until) ;; *) return 1 ;; esac
  done
  case ${W[K]:-} in
    cat | head | tail | grep | wc | diff) return 0 ;;
    git) sub=${W[K + 1]:-} ;;
    *) return 1 ;;
  esac
  case $sub in diff | log | show | blame | status | add) ;; *) return 1 ;; esac
  for w in "${W[@]:K+2}"; do
    case $w in --output* | --ext-diff | --textconv) return 1 ;; esac
    if [ "$sub" = add ]; then
      case $w in --edit | --patch | --interactive) return 1 ;; --*) ;; -*[epi]*) return 1 ;; esac
    fi
  done
  return 0
}

# _pc_opaque — W (from K) runs a string this guard cannot read as commands.
_pc_opaque() {
  local w c=${W[K]:-}
  c=${c##*/}
  case $c in
    eval) return 0 ;;
    sh | bash | zsh | dash | ksh | mksh | ash | fish)
      for w in "${W[@]:K+1}"; do case $w in --*) ;; -*c*) return 0 ;; -*) ;; *) return 1 ;; esac; done
      return 0 ;;
    python* | perl* | ruby* | node | nodejs | bun | deno | php* | lua* | osascript | pwsh | powershell | tclsh* | Rscript)
      for w in "${W[@]:K+1}"; do
        case $w in eval | - | --eval* | --print* | -Command | -command | -[cerpE] | -[a-zA-Z]*[ceE]*) return 0 ;; -*) ;; *) return 1 ;; esac
      done
      return 0 ;;
  esac
  return 1
}

# _pc_redirects <raw segment> — judge each redirection that writes.
_pc_redirects() {
  local x t skip=0 op
  local -a rw
  local IFS=$CMD_SEP
  # shellcheck disable=SC2206 # split on CMD_SEP on purpose; set -f rules out globbing
  rw=($1)
  IFS=$' \t\n'
  for x in ${rw[@]+"${rw[@]}"}; do
    if [ "$skip" = 1 ]; then skip=0; _pc_names "$x" "a redirection onto it"; continue; fi
    op=""
    if [[ $x =~ $_CMD_RE_REDIR ]]; then op=${BASH_REMATCH[1]} t=${BASH_REMATCH[2]}
    elif [[ $x =~ $_CMD_RE_AMP ]]; then op='&>' t=${BASH_REMATCH[1]}; fi
    case $op in
      '>' | '>>' | '>|' | '<>' | '&>') ;;
      '>&') [[ $t =~ ^[0-9]*-?$ ]] && continue ;;
      *) continue ;;
    esac
    if [ -n "$t" ]; then _pc_names "$t" "a redirection onto it"; else skip=1; fi
  done
}

if [ "$P_TOOL" = Bash ]; then
  PC_LINE=${GF[3]}
  [ -n "$PC_LINE" ] || guard_fail "a Bash call without tool_input.command"
  if [[ $PC_LINE =~ (^|[^A-Za-z0-9_\$])[A-Za-z_][A-Za-z0-9_.:-]*[[:space:]]*\([[:space:]]*\) ]]; then PC_REDEFINES=1; fi
  CMD_ON_SEG=_pc_seg
  cmd_parse "$PC_LINE"
  opaque=$CMD_OPAQUE
  for j in ${PC_RAW[@]+"${!PC_RAW[@]}"}; do
    _pc_redirects "${PC_RAW[j]}"
    cmd_words "${PC_V[j]}"
    K=${PC_K[j]}
    if _pc_read_only; then continue; fi
    for w in ${W[@]+"${W[@]}"}; do _pc_names "$w" "named by \`${W[K]:-$w}\`"; done
    if _pc_opaque; then opaque=1; fi
  done
  if [ "$opaque" = 1 ]; then
    for i in "${!PC_PATHS[@]}"; do
      if paths_imatch "$PC_LINE" "${PC_STEM_RE[i]}"; then
        _pc_need "$i" "in a command it cannot read: eval, sh -c, an interpreter's -c/-e"
      fi
    done
  fi
else
  paths_of_edit "${GF[0]}" "${GF[1]}" "${GF[2]}"
  for p in "${EDIT_PATHS[@]}"; do _pc_identity "$p" ""; done
fi

[ -n "$PC_NEED" ] || guard_allow
what=$(IFS=';'; echo "${PC_WHAT[*]}")
read -r kind other <<<"$PC_NEED"
if [ -n "$other" ]; then
  guard_fail "this call changes $what — files of two approval kinds. One approval covers one kind: make the changes one at a time"
fi
case $kind in
  constitution) reason="this call would change $what: the team's constitution, or the hooks that guard it. An agent never amends it on its own initiative" ;;
  *) reason="this call would change $what: a gate config, which loosens or tightens the project's own gates. An agent never changes it on its own initiative" ;;
esac
approval_require "$kind" "$reason" \
  "Only the user approves it: draft the change with the task skill's \`constitution\` verb, which prints the phrase the user types as their whole message — a plain \"yes\" does not approve it. Reading is allowed with a bare cat, head, tail, grep, wc, diff, or git diff/log/show/blame/status/add."
