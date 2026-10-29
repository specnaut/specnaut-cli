# shellcheck shell=bash disable=SC2034
# (SC2034: PATHS_* are read by the sourcing guard.)
# Sourced after _guard.sh by the guards that protect files (protect-generated,
# protect-constitution) and by approve-on-prompt.sh (the guarded list):
# the one home of "which file does this edit name" (spec 036 § 11 F5, spec 038
# § 5).
#
# Decided by identity, never by text: each target is resolved against the
# payload cwd, `.`/`..`/`//` collapsed, then its deepest existing ancestor is
# compared with `-ef` to the protected path's, the remainder case-folded — so
# a symlink, a case variant on APFS, or a path relative to a subdirectory
# names the same file. Codex paths come from the patch headers
# `*** Add|Update|Delete File:` and `*** Move to:` (indented, CRLF, any case).

# The project-owned files spec 038 guards. The TypeScript twin is
# src/domain/constitution_paths.ts; a test holds the two equal.
PATHS_CONSTITUTION=docs/constitution.md
PATHS_GATE_CONFIGS=(.specnaut/size-limits.yml .specnaut/boundaries.yml .specnaut/ui.yml)

# paths_of_edit <file_path> <notebook_path> <patch> — EDIT_PATHS: the files
# this Edit/Write/MultiEdit/NotebookEdit or apply_patch call names, read from
# the payload fields the caller passes. Any other tool is refused; so is an
# edit from which no path can be read. Call it as a plain statement, never
# under `||` or `if`: either would switch `set -e` and the ERR trap off inside.
paths_of_edit() {
  local re_file re_move line p
  EDIT_PATHS=()
  case "$GUARD_HARNESS:$P_TOOL" in
    claude:Edit | claude:Write | claude:MultiEdit) EDIT_PATHS=("$1") ;;
    claude:NotebookEdit) EDIT_PATHS=("$2") ;;
    codex:apply_patch)
      re_file='^[[:space:]]*\*\*\*[[:space:]]*(add|update|delete)[[:space:]]+file:[[:space:]]*(.*)$'
      re_move='^[[:space:]]*\*\*\*[[:space:]]*move[[:space:]]+to:[[:space:]]*(.*)$'
      shopt -s nocasematch
      while IFS= read -r line || [ -n "$line" ]; do
        if [[ $line =~ $re_file ]]; then p=${BASH_REMATCH[2]}
        elif [[ $line =~ $re_move ]]; then p=${BASH_REMATCH[1]}
        else continue; fi
        p=${p%"${p##*[![:space:]]}"} # trailing blanks, a CRLF's \r among them
        if [ -n "$p" ]; then EDIT_PATHS+=("$p"); fi
      done <<<"$3"
      shopt -u nocasematch ;;
    *) guard_fail "expected an edit, got tool '$P_TOOL' on $GUARD_HARNESS" ;;
  esac
  if [ ${#EDIT_PATHS[@]} = 0 ] || [ -z "${EDIT_PATHS[0]}" ]; then
    guard_fail "could not read the file path this $P_TOOL edits — refusing an edit it cannot check"
  fi
}

# paths_norm_to <var> <path> — <path> absolute against the payload cwd, with
# //, . and .. collapsed, into <var>; a Windows path (`C:\…`, `src\…`) first in
# this shell's own form. No subshell: the Bash arm of protect-constitution.sh
# normalizes every word of a command.
paths_norm_to() {
  local _pn_p _pn_part _pn_out="" IFS=/
  guard_path _pn_p "$2"
  case $_pn_p in /*) ;; *) _pn_p="$GUARD_CWD/$_pn_p" ;; esac
  for _pn_part in $_pn_p; do
    case $_pn_part in '' | .) ;; ..) _pn_out=${_pn_out%/*} ;; *) _pn_out="$_pn_out/$_pn_part" ;; esac
  done
  printf -v "$1" '%s' "${_pn_out:-/}"
}

# paths_norm <path> — paths_norm_to, printed.
paths_norm() {
  local r
  paths_norm_to r "$1"
  printf '%s' "$r"
}

# paths_names <abs target> <path relative to the root> [under] — the target IS
# the protected path (with `under`: is it, or lies beneath it). Walks up the
# target; at each existing ancestor, an `-ef` match against an existing
# prefix of the protected path decides, the rest compared case-folded.
# Needs GUARD_ROOT: call guard_root first.
paths_names() {
  local anc=$1 rest="" k n r=1 IFS=/
  local -a pc suf
  # shellcheck disable=SC2206 # split on / on purpose; set -f rules out globbing
  pc=($2) # not `read <<<`: a here-string is a temp file per call before bash 5.1
  IFS=$' \t\n'
  n=${#pc[@]}
  suf[n]=""
  for ((k = n - 1; k >= 0; k--)); do suf[k]="${pc[k]}${suf[k + 1]:+/${suf[k + 1]}}"; done
  shopt -s nocasematch
  while [ "$r" = 1 ]; do
    if [ -e "$anc" ]; then
      local pk=$GUARD_ROOT
      for ((k = 0; k <= n; k++)); do
        [ -e "$pk" ] || break
        if [ "$anc" -ef "$pk" ]; then
          if [[ $rest == "${suf[k]}" ]]; then r=0; break; fi
          if [ "${3:-}" = under ] && { [ -z "${suf[k]}" ] || [[ $rest == "${suf[k]}"/* ]]; }; then r=0; break; fi
        fi
        if [ "$k" -lt "$n" ]; then pk="$pk/${pc[k]}"; fi
      done
    fi
    if [ "$r" = 0 ] || [ "$anc" = / ]; then break; fi
    rest="${anc##*/}${rest:+/$rest}"
    anc=${anc%/*}
    anc=${anc:-/}
  done
  shopt -u nocasematch
  return "$r"
}

# paths_imatch <text> <ere> — <text> matches, ASCII case ignored. Sets
# nocasematch around its own test only: paths_names unsets it on return.
paths_imatch() { local r=1; shopt -s nocasematch; if [[ $1 =~ $2 ]]; then r=0; fi; shopt -u nocasematch; return "$r"; }

# paths_ere_to <var> <text> — <text> as an ERE matching itself, into <var>.
paths_ere_to() {
  local _pe_s=$2 _pe_o="" _pe_c
  while [ -n "$_pe_s" ]; do
    _pe_c=${_pe_s:0:1} _pe_s=${_pe_s:1}
    case $_pe_c in [.^\$*+?\(\)\[\]{}\|\\]) _pe_o+="\\$_pe_c" ;; *) _pe_o+=$_pe_c ;; esac
  done
  printf -v "$1" '%s' "$_pe_o"
}

# paths_rel_to <var> <path from the root> — that path as written from the
# payload cwd (`../docs/x` from `src/`), into <var>; "" when the cwd is not
# inside the root. Needs GUARD_ROOT.
_PATHS_SUB="unset"
paths_rel_to() {
  local d=$GUARD_CWD p=$2 up="" sub
  if [ "$_PATHS_SUB" = unset ]; then
    _PATHS_SUB=""
    while ! [ "$d" -ef "$GUARD_ROOT" ]; do
      if [ -z "$d" ] || [ "$d" = / ]; then _PATHS_SUB=-; break; fi
      _PATHS_SUB="${d##*/}${_PATHS_SUB:+/$_PATHS_SUB}" d=${d%/*}
    done
  fi
  sub=$_PATHS_SUB
  if [ "$sub" = - ]; then printf -v "$1" '%s' ""; return 0; fi
  while [ -n "$sub" ] && [[ $p == */* ]] && [ "${sub%%/*}" = "${p%%/*}" ]; do
    if [[ $sub == */* ]]; then sub=${sub#*/}; else sub=""; fi
    p=${p#*/}
  done
  while [ -n "$sub" ]; do
    up+="../"
    if [[ $sub == */* ]]; then sub=${sub#*/}; else sub=""; fi
  done
  printf -v "$1" '%s' "$up$p"
}

# paths_pattern <word> — PATHS_RE: the ERE of every path the shell could
# expand <word> to ($… and {…,…} anything; * ? […] within one component), and
# PATHS_LIT=1 when it keeps a literal character other than `/` and `.`.
# Returns 1 when the word holds nothing the shell would expand.
paths_pattern() {
  local w=$1 i=0 n=${#1} c re="" wild=0 j d e
  PATHS_LIT=0
  while [ "$i" -lt "$n" ]; do
    c=${w:i:1} i=$((i + 1))
    # A brace with no closing one is the reserved word, or plain text.
    if [ "$c" = '{' ] && [[ ${w:i} != *'}'* ]]; then c=lone; fi
    case $c in
      '$' | '{')
        wild=1 re+='.*'
        if [ "$c" = '{' ] || [ "${w:i:1}" = '{' ]; then
          [ "$c" = '{' ] || i=$((i + 1))
          d=1
          while [ "$i" -lt "$n" ] && [ "$d" -gt 0 ]; do
            case ${w:i:1} in '{') d=$((d + 1)) ;; '}') d=$((d - 1)) ;; esac
            i=$((i + 1))
          done
        elif [[ ${w:i:1} == [@*#?\$!-] ]]; then i=$((i + 1))
        else while [ "$i" -lt "$n" ] && [[ ${w:i:1} == [A-Za-z0-9_] ]]; do i=$((i + 1)); done; fi ;;
      '*') wild=1 re+='[^/]*' ;;
      '?') wild=1 re+='[^/]' ;;
      '[')
        j=${w:i}
        if [[ $j == *']'* ]]; then
          j=${j%%]*} i=$((i + ${#j} + 1)) wild=1
          case $j in '!'*) j="^${j:1}" ;; esac
          re+="[$j]"
        else re+='\[' PATHS_LIT=1; fi ;;
      lone) PATHS_LIT=1 re+='\{' ;;
      *)
        case $c in / | .) ;; *) PATHS_LIT=1 ;; esac
        paths_ere_to e "$c"
        re+=$e ;;
    esac
  done
  PATHS_RE="^$re\$"
  [ "$wild" = 1 ]
}
