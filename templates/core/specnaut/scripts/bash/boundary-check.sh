#!/usr/bin/env bash
# Hold the project's domain paths free of the imports it forbids.
#
#   boundary-check.sh                                  the index and the work tree
#   boundary-check.sh --head <sha> [--objects <dir>]   that commit, from git's
#                                                      objects only (_explicit_head.sh)
#
# Reads three flat lists from `.specnaut/boundaries.yml`, through `_config.sh`
# beside it (the grammar is stated there):
#
#   domain:   the paths whose tracked files are checked, from the repo root
#   forbid:   extended regular expressions no line of those files may match
#   exempt:   globs that keep a file out, matched as the size ratchet matches
#             its own (`path` or `/path`, shell `case` semantics)
#
# Specnaut ships no copy of that file and no default pattern: which imports
# break a domain is the project's call, and a guessed default would report a
# pass that checked nothing.
#
# The tracked files are listed by git, never by a glob or a walk, so an
# untracked or ignored file is never read. Only regular files (modes 100644 and
# 100755) are, and never through a link: a symlink, committed or swapped in by
# the work tree, could point anywhere on the disk. Grep reads every file as bytes
# (LC_ALL=C, -a): no locale's decoding and no NUL makes it skip a line, so no file is
# passed that was not read. A conflicted path is read
# when any of its stages is a regular file. Given a head, its tree is listed and each
# blob read by id: no work tree file is. No GIT_* variable the script inherits is
# kept: a hook's GIT_DIR or index names another view of the repository.
#
# Exit codes — a skip is never a pass, and neither is a check that broke:
#   0   every tracked file under `domain:` was checked and none matches
#   1   at least one match — each printed as `path:line: pattern`
#   2   the check could not run: the config is unreadable or holds a pattern
#       that does not compile, a `domain:` path git cannot list (outside the
#       repo), a file grep cannot read, not a git work tree, `_config.sh`
#       missing, an unknown argument, or a --head git cannot read as a commit
#   4   skipped, with the reason on stdout: no config, no `forbid:` patterns,
#       no `domain:` paths, or no file left to check under them
set -uo pipefail

NAME=boundary-check
fail() { echo "$NAME: $*" >&2; exit 2; }
skip() { echo "$NAME: skipped — $*"; exit 4; }

usage() { fail "usage: boundary-check.sh [--head <sha> [--objects <dir>]]"; }

# Sourced before the `cd` below: the script's own directory may be relative.
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/_config.sh disable=SC1091
{ . "$here/_config.sh" && . "$here/_explicit_head.sh"; } ||
  fail "_config.sh or _explicit_head.sh is missing beside the script"
# Every git call below, given an objects folder, reads it under explicit_head_git's settings.
git() { explicit_head_git "$@"; }
explicit_head_clear_env
# Bytes, not characters: under a locale that cannot decode a byte, no `.` of a pattern
# matches it, and an import spelled around it goes unreported.
export LC_ALL=C

rc=0 && explicit_head_options "$@" || rc=$?
[ "$rc" -ne 2 ] || fail "$EXPLICIT_REFUSAL"
[ "$rc" -eq 0 ] || usage

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "not inside a git work tree"
cd -- "$REPO_ROOT" || fail "cannot enter $REPO_ROOT"
explicit_head_from_options git || fail "--head: $EXPLICIT_REFUSAL"
explicit_head_env

config_present "$CONFIG_BOUNDARIES" || skip "no $CONFIG_BOUNDARIES"
# Captured before it is split, so its exit 2 is seen.
records="$(config_parse "$CONFIG_BOUNDARIES" "" "domain forbid exempt")" ||
  fail "$CONFIG_BOUNDARIES: $records"

domains=() domain_lines=() patterns=() exempt=()
while IFS=$'\t' read -r kind n key value; do
  [ "$kind" = L ] || continue
  case "$key" in
    domain) domains+=("$value") domain_lines+=("$n") ;;
    exempt) exempt+=("$value") ;;
    forbid)
      # A pattern grep refuses would make every file "unreadable" at once;
      # name the entry instead. Exit 1 is "no match", which is fine here.
      grep -E -q -e "$value" </dev/null 2>/dev/null
      [ "$?" -le 1 ] ||
        fail "$CONFIG_BOUNDARIES: line $n: forbid: '$value' is not an extended regular expression"
      patterns+=("$value")
      ;;
  esac
done <<<"$records"

[ "${#patterns[@]}" -gt 0 ] || skip "no forbid: patterns in $CONFIG_BOUNDARIES"
[ "${#domains[@]}" -gt 0 ] || skip "no domain: paths in $CONFIG_BOUNDARIES"

is_exempt() { config_exempt "$1" ${exempt[@]+"${exempt[@]}"}; }

# `ls-files -z` output holds NULs, which no bash variable can, and a process
# substitution's exit status is lost on bash 3.2 — so it goes through a file.
work="$(mktemp -d "${TMPDIR:-/tmp}/boundary-check.XXXXXX")" || fail "cannot create a temporary folder"
listing="$work/listing" blob="$work/blob"
trap 'rm -rf -- "$work"' EXIT

list_domain() {
  if [ -n "$EXPLICIT_HEAD" ]; then
    # No `--`: after --end-of-options, ls-tree takes it for one more path.
    git -c core.quotePath=false ls-tree -r -z --end-of-options "$EXPLICIT_HEAD" "$1"
  else
    git -c core.quotePath=false --literal-pathspecs ls-files -z -s -- "$1"
  fi
}

files=() objects=() tracked=0
for i in "${!domains[@]}"; do
  domain="${domains[$i]}"
  err="$(list_domain "$domain" 2>&1 >"$listing")" ||
    fail "$CONFIG_BOUNDARIES: line ${domain_lines[$i]}: domain: '$domain' cannot be listed — ${err%%$'\n'*}"
  found=0 prev=""
  # Each record: `<mode> <object> <stage>\t<path>` from the index, or `<mode> blob
  # <object>\t<path>` from a head's tree. A conflicted path comes once per stage,
  # adjacent; it is checked once, at its first stage that is a regular file.
  while IFS= read -r -d '' rec; do
    path="${rec#*$'\t'}"
    case "${rec%% *}" in 100644 | 100755) ;; *) continue ;; esac
    [ "$path" != "$prev" ] || continue
    prev="$path"
    found=1 tracked=$((tracked + 1))
    if [ -z "$EXPLICIT_HEAD" ] && [ -L "$path" ]; then continue; fi
    meta="${rec%%$'\t'*}" && meta="${meta#* }"
    case "$meta" in blob\ *) object="${meta#blob }" ;; *) object="${meta%% *}" ;; esac
    is_exempt "$path" || { files+=("$path") && objects+=("$object"); }
  done <"$listing"
  [ "$found" = 1 ] || echo "  note: domain: '$domain' (line ${domain_lines[$i]}) names no tracked file"
done

[ "$tracked" -gt 0 ] || skip "no tracked file under domain: in $CONFIG_BOUNDARIES"
[ "${#files[@]}" -gt 0 ] || skip "every tracked file under domain: is exempt or a link"

grep_args=()
for pat in "${patterns[@]}"; do grep_args+=(-e "$pat"); done

# A head's file is its blob, written out by id; the work tree's is read in place.
violations=()
for i in "${!files[@]}"; do
  file="${files[$i]}" src="${files[$i]}"
  if [ -n "$EXPLICIT_HEAD" ]; then
    git cat-file blob "${objects[$i]}" >"$blob" || fail "$file: git could not read its blob"
    src="$blob"
  fi
  # One pass with every pattern; only a file that matches is read again, per
  # pattern, to say which one. -a: a file holding a NUL is read as text, never skipped.
  grep -E -a -q "${grep_args[@]}" -- "$src"
  status=$?
  [ "$status" -le 1 ] || fail "$file: grep could not read it (exit $status)"
  [ "$status" = 0 ] || continue
  for pat in "${patterns[@]}"; do
    # Only the line numbers: a line's own bytes, a NUL among them, never reach a variable.
    hits="$(grep -E -a -n -e "$pat" -- "$src" | cut -d: -f1)"
    status=$?
    [ "$status" -le 1 ] || fail "$file: grep could not read it (exit $status)"
    while IFS= read -r hit; do
      [ -n "$hit" ] && violations+=("$file:$hit: $pat")
    done <<<"$hits"
  done
done

if [ "${#violations[@]}" -gt 0 ]; then
  echo "$NAME: ${#violations[@]} forbidden import(s) in ${#files[@]} file(s) under domain:" >&2
  for v in "${violations[@]}"; do echo "  $v" >&2; done
  echo "  the domain stays free of frameworks — move the dependency behind a port" >&2
  exit 1
fi
echo "$NAME: ${#files[@]} file(s) under domain: clean of ${#patterns[@]} pattern(s)"
exit 0
