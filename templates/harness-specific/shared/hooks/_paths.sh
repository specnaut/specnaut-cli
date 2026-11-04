# shellcheck shell=bash
# Sourced after _guard.sh by protect-generated.sh: the one home of "which file
# does this edit name" (spec 036 § 11 F5).
#
# Decided by identity, never by text: each target is resolved against the
# payload cwd, `.`/`..`/`//` collapsed, then its deepest existing ancestor is
# compared with `-ef` to the protected path's, the remainder case-folded — so
# a symlink, a case variant on APFS, or a path relative to a subdirectory
# names the same file. Codex paths come from the patch headers
# `*** Add|Update|Delete File:` and `*** Move to:` (indented, CRLF, any case).

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
# this shell's own form.
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
  while :; do
    if [ -e "$anc" ] && _paths_names_at "$anc" "$rest" "${3:-}"; then r=0; break; fi
    [ "$anc" != / ] || break
    rest="${anc##*/}${rest:+/$rest}"
    anc=${anc%/*}
    anc=${anc:-/}
  done
  shopt -u nocasematch
  return "$r"
}

# _paths_names_at <existing ancestor> <rest of the target> <under|""> — one
# step of paths_names' walk: the ancestor is the same file (`-ef`) as an
# existing prefix of the protected path, and the rest of the target is the
# rest of that path (with `under`: it, or beneath it), compared under the
# caller's nocasematch. Reads paths_names' pc, suf and n.
_paths_names_at() {
  local pk=$GUARD_ROOT k
  for ((k = 0; k <= n; k++)); do
    [ -e "$pk" ] || return 1
    if [ "$1" -ef "$pk" ]; then
      if [[ $2 == "${suf[k]}" ]]; then return 0; fi
      if [ "$3" = under ] && { [ -z "${suf[k]}" ] || [[ $2 == "${suf[k]}"/* ]]; }; then return 0; fi
    fi
    if [ "$k" -lt "$n" ]; then pk="$pk/${pc[k]}"; fi
  done
  return 1
}
