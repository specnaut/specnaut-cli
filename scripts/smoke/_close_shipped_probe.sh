# shellcheck shell=bash
# Sourced by _common.sh, never run: the close-shipped probe every backlog smoke
# shares, on its own so the shared header stays within its size.

# --- close-shipped.sh, run against recording stubs (cli#711) -------------
# A behaviour check, not a text grep: what the installed script called, in
# order, what it printed and how it exited — never how its source happens to
# be spelled, so a refactor that keeps the behaviour keeps the check green.
#
# probe_close_shipped "<open issues>" "<sweep stdout>" <issue>… — from a
# scaffold's root: copies the installed backlog scripts to a scratch dir, replaces
# the siblings close-shipped.sh calls with stubs that record their argv to
# `calls`, runs it there, and sets CS_RC, CS_OUT (stdout+stderr), CS_CALLS.
# cascade-check.sh exits 11 (open) for a listed issue, 12 (closed) otherwise;
# sweep-closed.sh prints <sweep stdout> and exits 0.
probe_close_shipped() {
  local open=$1 sweep=$2 tmp dir s
  shift 2
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/close-shipped.XXXXXX") || return 1
  dir=$tmp/b
  cp -R .specnaut/scripts/backlog "$dir" || { rm -rf -- "$tmp"; return 1; }
  for s in cascade-check move move-batch sweep-closed; do
    # shellcheck disable=SC2016 # the stub expands $*, not this shell
    printf '#!/usr/bin/env bash\necho "%s${*:+ $*}" >>"%s/calls"\n' "$s" "$dir" >"$dir/$s.sh"
  done
  # shellcheck disable=SC2016 # the stub expands $1, not this shell
  printf 'case " %s " in *" $1 "*) exit 11 ;; esac\nexit 12\n' "$open" >>"$dir/cascade-check.sh"
  printf '%s\n' "$sweep" >"$dir/sweep.out"
  printf 'cat "%s/sweep.out"\n' "$dir" >>"$dir/sweep-closed.sh"
  : >"$dir/calls"
  CS_RC=0
  CS_OUT=$(bash "$dir/close-shipped.sh" "$@" 2>&1) || CS_RC=$?
  CS_CALLS=$(cat "$dir/calls")
  rm -rf -- "$tmp"
}

# close_shipped_was <exit> "<calls, one per line>" <line prefix>… — the last
# probe exited <exit>, made exactly those calls, and printed a line starting
# with each prefix.
close_shipped_was() {
  local want=$1 calls=$2 l
  shift 2
  [ "$CS_RC" = "$want" ] && [ "$CS_CALLS" = "$calls" ] || return 1
  for l in "$@"; do
    case $'\n'"$CS_OUT" in *$'\n'"$l"*) ;; *) return 1 ;; esac
  done
}
