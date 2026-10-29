#!/usr/bin/env bash
# Hold the project's domain paths free of the imports it forbids.
#
#   boundary-check.sh
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
# the work tree, could point anywhere on the disk. Binary files are skipped.
#
# Exit codes — a skip is never a pass, and neither is a check that broke:
#   0   every tracked file under `domain:` was checked and none matches
#   1   at least one match — each printed as `path:line: pattern`
#   2   the check could not run: the config is unreadable or holds a pattern
#       that does not compile, a `domain:` path git cannot list (outside the
#       repo), a file grep cannot read, not a git work tree, `_config.sh`
#       missing, or an argument (the script takes none)
#   4   skipped, with the reason on stdout: no config, no `forbid:` patterns,
#       no `domain:` paths, or no file left to check under them
set -uo pipefail

NAME=boundary-check
fail() { echo "$NAME: $*" >&2; exit 2; }
skip() { echo "$NAME: skipped — $*"; exit 4; }

[ "$#" -eq 0 ] || fail "usage: boundary-check.sh (it takes no arguments)"

# Sourced before the `cd` below: the script's own directory may be relative.
# shellcheck source=SCRIPTDIR/_config.sh
. "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/_config.sh" ||
  fail "_config.sh is missing beside the script"

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "not inside a git work tree"
cd -- "$REPO_ROOT" || fail "cannot enter $REPO_ROOT"

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

is_exempt() {
  local glob
  # shellcheck disable=SC2254 # the glob is the pattern, in both arms
  for glob in ${exempt[@]+"${exempt[@]}"}; do
    case "$1" in $glob) return 0 ;; esac
    case "/$1" in $glob) return 0 ;; esac
  done
  return 1
}

# `ls-files -z` output holds NULs, which no bash variable can, and a process
# substitution's exit status is lost on bash 3.2 — so it goes through a file.
listing="$(mktemp "${TMPDIR:-/tmp}/boundary-check.XXXXXX")" || fail "cannot create a temporary file"
trap 'rm -f -- "$listing"' EXIT

files=() tracked=0
for i in "${!domains[@]}"; do
  domain="${domains[$i]}"
  err="$(git -c core.quotePath=false --literal-pathspecs ls-files -z -s -- "$domain" 2>&1 >"$listing")" ||
    fail "$CONFIG_BOUNDARIES: line ${domain_lines[$i]}: domain: '$domain' cannot be listed — ${err%%$'\n'*}"
  found=0 prev=""
  # Each record: `<mode> <object> <stage>\t<path>`. A conflicted path comes
  # once per stage, adjacent; it is checked once.
  while IFS= read -r -d '' rec; do
    path="${rec#*$'\t'}"
    [ "$path" != "$prev" ] || continue
    prev="$path"
    case "${rec%% *}" in 100644 | 100755) ;; *) continue ;; esac
    found=1 tracked=$((tracked + 1))
    [ -L "$path" ] && continue
    is_exempt "$path" || files+=("$path")
  done <"$listing"
  [ "$found" = 1 ] || echo "  note: domain: '$domain' (line ${domain_lines[$i]}) names no tracked file"
done

[ "$tracked" -gt 0 ] || skip "no tracked file under domain: in $CONFIG_BOUNDARIES"
[ "${#files[@]}" -gt 0 ] || skip "every tracked file under domain: is exempt or a link"

grep_args=()
for pat in "${patterns[@]}"; do grep_args+=(-e "$pat"); done

violations=()
for file in "${files[@]}"; do
  # One pass with every pattern; only a file that matches is read again, per
  # pattern, to say which one.
  grep -E -I -q "${grep_args[@]}" -- "$file"
  status=$?
  [ "$status" -le 1 ] || fail "$file: grep could not read it (exit $status)"
  [ "$status" = 0 ] || continue
  for pat in "${patterns[@]}"; do
    hits="$(grep -E -I -n -e "$pat" -- "$file")"
    status=$?
    [ "$status" -le 1 ] || fail "$file: grep could not read it (exit $status)"
    while IFS= read -r hit; do
      [ -n "$hit" ] && violations+=("$file:${hit%%:*}: $pat")
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
