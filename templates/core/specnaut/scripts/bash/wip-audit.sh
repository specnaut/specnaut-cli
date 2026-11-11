#!/usr/bin/env bash
# What git says about each backlog item still on the board (spec 050, cli#673)
# — the one home of "landed, unpushed, active or idle". `/task groom`'s WIP
# audit feeds it the numbers in `Ready` and `In progress` and acts on its lines
# per the table in groom.md; this script decides nothing about the board.
#
# Read-only and offline: it never fetches and never writes. It prints fixed
# tokens, validated digits and shas only — never a commit subject, a body or a
# ref name, which are text anyone with a merged commit or a fetched branch
# chose. No eval, no `bash -c`, every expansion quoted, refs passed whole.
#
# Output, one line per item in the order given, first match wins:
#   ACTIVE   <n> <sha>  a ref under refs/heads or refs/remotes/origin, on neither
#                       base, has a commit off the base whose subject names #<n>,
#                       or its own commits set .specnaut/feature.json's
#                       linked_issue to <n>; <sha> is that ref's tip
#   UNPUSHED <n> <sha>  a commit on the local base, not on origin/<base>, names it
#   LANDED   <n> <sha>  a commit on the published base names it (origin/<base>,
#                       or the local base when there is no origin ref)
#   IDLE     <n>        nothing names it
#   DEFERRED <n>        beyond --limit, not checked
#   audited <A>, active <C>, unpushed <U>, landed <L>, idle <I>, deferred <D>
#
# "Names #<n>" is the subject only, in either of two shapes: the scope the
# chain itself writes (`feat(12): …`, `plan(12): …`, merge-squash.md), or a
# whole `#12` reference — not after a letter, digit, `_`, `/`, `.` or `-`
# (owner/repo#12, x#12), not before a digit (#120).
# `<n>@<epoch>` — the item's creation time — ignores commits older than it: a
# number reused by imported history, or a PR number, names something else.
# The feature.json link carries no date and is never filtered.
# An item with no creation time to read (`view.sh` printed `—`) is passed as
# `<n>` alone, and the caller says the date filter was off for it.
#
# A read that fails is never taken for one that found nothing: git's own
# errors are discarded (they can carry ref text) and the script stops.
#
# Exit: 0 classified · 2 usage (a number not ^[1-9][0-9]{0,9}$, an epoch not
# ^[0-9]{1,12}$) · 3 the base is unknown or git could not be read — nothing is
# classified then, so no IDLE is ever reported for an item that went unchecked.
#
# Usage: wip-audit.sh [--limit <N>] <num>[@<epoch>]…   (--limit default 20)
#        wip-audit.sh --gate …                       (the intake gate, below)
set -euo pipefail
export GIT_OPTIONAL_LOCKS=0 GIT_NO_LAZY_FETCH=1
# Git Bash on Windows rewrites an argument shaped like a path list, which
# `<ref>:<path>` is; git must receive it as written.
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"
here=$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

usage() {
  echo "usage: wip-audit.sh [--limit <N>] <num>[@<epoch>]..." >&2
  echo "an item with no creation time: see the header of .specnaut/scripts/bash/wip-audit.sh" >&2
  exit 2
}
NUM='^[1-9][0-9]{0,9}$'
# first_naming <n> <epoch> <records> — the sha of the first record whose
# subject names #<n> and whose time is not older than <epoch>.
first_naming() {
  local n=$1 since=$2 sha ct subject
  local re="(^|[^[:alnum:]_/.-])#${n}([^0-9]|$)" scope="^[a-z]+\\(${n}\\)!?: "
  while IFS=$'\x1f' read -r sha ct subject; do
    [ -n "$sha" ] || continue
    if [ "$ct" = LINK ]; then
      [ "$subject" = "$n" ] && { printf '%s' "$sha"; return 0; }
      continue
    fi
    [ "$ct" -ge "$since" ] || continue
    if [[ $subject =~ $re ]] || [[ $subject =~ $scope ]]; then printf '%s' "$sha"; return 0; fi
  done <<<"$3"
  return 1
}
# unread, present and the base's refs: their one home, beside this script.
# shellcheck source=./_base_refs.sh
. "$here/_base_refs.sh"
# --gate is the intake gate (cli#760): its rule, lines and exits are the
# header of _intake_gate.sh. This script only hands it the arguments.
if [ "${1:-}" = --gate ]; then
  shift
  # shellcheck source=./_intake_gate.sh
  . "$here/_intake_gate.sh"
  intake_gate "$@"
fi
limit=20 items=()
while [ $# -gt 0 ]; do
  case $1 in
    --limit) [ $# -ge 2 ] && [[ $2 =~ $NUM ]] || usage; limit=$2; shift 2 ;;
    *) [[ $1 =~ ^([1-9][0-9]{0,9})(@[0-9]{1,12})?$ ]] || usage; items+=("$1"); shift ;;
  esac
done
[ ${#items[@]} -gt 0 ] || usage

resolve_base_refs

# Every history is read whole before any item is matched: a failed read is exit 3.
fmt='%H%x1f%ct%x1f%s'
landed=$(git --no-pager log --format="$fmt" "$published" -- 2>/dev/null) || unread "$published"
unpushed=""
if [ -n "$remote" ] && [ -n "$local" ]; then
  unpushed=$(git --no-pager log --format="$fmt" "$local" --not "$remote" -- 2>/dev/null) || unread "$local"
fi
# merged <ref> — 0 when it is already on the published or the local base: a
# branch landed but not pushed is UNPUSHED evidence, not active work.
merged() {
  local b s
  for b in "$published" ${local:+"$local"}; do
    s=0
    git --no-pager merge-base --is-ancestor "$1" "$b" 2>/dev/null || s=$?
    [ "$s" -le 1 ] || unread "a ref"
    [ "$s" -ne 0 ] || return 0
  done
  return 1
}
# Off-base work: one record per commit, tagged with its ref's tip, plus one
# LINK record per ref whose own commits changed feature.json to name an issue
# — one inherited unchanged from the base it forked from names someone else's.
refs=$(git --no-pager for-each-ref --format='%(refname)' refs/heads refs/remotes/origin) || unread refs
active=""
while IFS= read -r ref; do
  [ -n "$ref" ] && [ "$ref" != "refs/remotes/origin/HEAD" ] || continue
  [ "$ref" != "$remote" ] && [ "$ref" != "$local" ] || continue
  merged "$ref" && continue
  tip=$(git --no-pager rev-parse --verify --quiet "$ref^{commit}") || unread "a ref"
  off=$(git --no-pager log --format="$fmt" "$ref" --not "$published" ${local:+"$local"} -- 2>/dev/null) || unread "a ref"
  while IFS= read -r rec; do
    [ -n "$rec" ] && active+="$tip"$'\x1f'"${rec#*$'\x1f'}"$'\n'
  done <<<"$off"
  fj=.specnaut/feature.json
  listed=$(git --no-pager ls-tree --name-only "$ref" -- "$fj" 2>/dev/null) || unread "a ref"
  [ -n "$listed" ] || continue
  fork=$(git --no-pager merge-base "$published" "$ref" 2>/dev/null) || unread "a ref"
  s=0
  git --no-pager diff --quiet "$fork" "$ref" -- "$fj" 2>/dev/null || s=$?
  [ "$s" -le 1 ] || unread "a ref"
  [ "$s" -eq 1 ] || continue
  json=$(git --no-pager show "$ref:$fj" 2>/dev/null) || unread "a ref"
  link=$(printf '%s\n' "$json" |
    sed -n 's/.*"linked_issue"[[:space:]]*:[[:space:]]*\([1-9][0-9]*\).*/\1/p' | sed -n 1p)
  [ -z "$link" ] || active+="$tip"$'\x1fLINK\x1f'"$link"$'\n'
done <<<"$refs"
audited=0 c=0 u=0 l=0 i=0 d=0
for item in "${items[@]}"; do
  n=${item%%@*} since=0
  [ "$item" = "$n" ] || since=${item#*@}
  if [ "$audited" -ge "$limit" ]; then
    printf 'DEFERRED %s\n' "$n"; d=$((d + 1)); continue
  fi
  audited=$((audited + 1))
  if sha=$(first_naming "$n" "$since" "$active"); then
    printf 'ACTIVE %s %s\n' "$n" "$sha"; c=$((c + 1))
  elif sha=$(first_naming "$n" "$since" "$unpushed"); then
    printf 'UNPUSHED %s %s\n' "$n" "$sha"; u=$((u + 1))
  elif sha=$(first_naming "$n" "$since" "$landed"); then
    printf 'LANDED %s %s\n' "$n" "$sha"; l=$((l + 1))
  else
    printf 'IDLE %s\n' "$n"; i=$((i + 1))
  fi
done
printf 'audited %s, active %s, unpushed %s, landed %s, idle %s, deferred %s\n' "$audited" "$c" "$u" "$l" "$i" "$d"
