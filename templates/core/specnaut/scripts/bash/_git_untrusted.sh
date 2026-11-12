# shellcheck shell=bash
# _git_untrusted.sh - git with hardened defaults, for reading a repository whose
# configuration nobody vetted. Sourced, never run: git-read.sh is its command
# line and lists its forms; collect-audit-scope.sh sources it beside itself.
#
# The one home of how git reads such a repository. Every call drops the GIT_*
# environment and runs with these defaults, each turning off a program or a
# redirection the repository's own configuration could otherwise name:
#
#   --no-pager --no-optional-locks --literal-pathspecs --no-lazy-fetch --no-replace-objects
#   -c core.fsmonitor=false           no fsmonitor program
#   -c core.hooksPath=/dev/null       no hook
#   -c log.showSignature=false        and every gpg.*program a path that cannot
#                                     exist: no signature program, for any format
#   -c submodule.recurse=false -c diff.submodule=short
#   --no-textconv --no-ext-diff --no-color on every form that diffs
#
# Four defaults are deliberate pairs, so dropping one leaves the other in force:
# --no-optional-locks and GIT_OPTIONAL_LOCKS=0; --no-lazy-fetch and GIT_NO_LAZY_FETCH=1;
# --no-replace-objects and GIT_NO_REPLACE_OBJECTS=1; gpg.program and gpg.openpgp.program,
# two names for one program. GIT_GRAFT_FILE names no file: info/grafts is never read.
# --no-lazy-fetch needs git 2.44; below it, a repository naming a promisor remote is
# refused rather than read, since reading a missing object would fetch it.
#
# The forms (gu_<form>) take data only - revisions, paths, a fixed-string pattern,
# a count - never a git option; each runs one fixed command line. They read objects
# and the index, never the work tree (no clean or smudge filter), and write nothing
# inside it. A refused argument prints "git-read: refused: <why>" and returns 2.
# _gu_rev, _gu_range, _gu_path and _gu_count are the one home of what an argument
# may look like. _gu_git runs a fixed argv under the same defaults, for scripts
# that source this file, never for an argv someone else composed.

_gu_here=$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
[ -f "$_gu_here/_scope_globs.sh" ] && [ -f "$_gu_here/_explicit_head.sh" ] ||
  { echo "git-read: _scope_globs.sh or _explicit_head.sh is missing from $_gu_here" >&2 && return 70; }
# shellcheck source=SCRIPTDIR/_scope_globs.sh disable=SC1091
. "$_gu_here/_scope_globs.sh" && . "$_gu_here/_explicit_head.sh"

# A revision: ref-name characters only, the whole string, never an option or a
# range. `+` is there for a tag carrying SemVer build metadata (v1.0.0+build.7).
_gu_rev() {
  local re='^[A-Za-z0-9._/@^~+-]+$'
  case "$1" in -* | *..*) return 1 ;; esac
  [ -z "$EXPLICIT_HEAD" ] || ! explicit_head_names_head "$1" || return 1
  [[ "$1" =~ $re ]]
}

# A two-dot range of two revisions.
_gu_range() {
  case "$1" in
    *...*) return 1 ;;
    *..*) _gu_rev "${1%%..*}" && _gu_rev "${1#*..}" ;;
    *) return 1 ;;
  esac
}

# A path: relative, inside the tree, forward slashes, one line.
_gu_path() {
  case "$1" in
    '' | /* | [A-Za-z]:* | *\\* | .. | ../* | */../* | */.. | *$'\n'* | *$'\r'*) return 1 ;;
  esac
}

# A positive count, the whole string.
_gu_count() { local re='^[1-9][0-9]*$' && [[ "$1" =~ $re ]]; }

_gu_refuse() { echo "git-read: refused: $1" >&2 && return 2; }
_gu_need_rev() { _gu_rev "$1" || _gu_refuse "not a revision${EXPLICIT_HEAD:+ (HEAD is not read given a head)}: $1"; }

_gu_need_paths() {
  local p
  for p in "$@"; do
    _gu_path "$p" || { _gu_refuse "not a relative path inside the tree: $p"; return 2; }
  done
}

# True when this git knows --no-lazy-fetch (2.44 or later). Cached.
_gu_lazy_flag() {
  if [ -z "${_GU_LAZY:-}" ]; then
    local v re='([0-9]+)\.([0-9]+)'
    v="$(_gu_env_run version 2>/dev/null)" || v=""
    _GU_LAZY=no
    if [[ "$v" =~ $re ]]; then
      local major="${BASH_REMATCH[1]}" minor="${BASH_REMATCH[2]}"
      { [ "$major" -gt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -ge 44 ]; }; } && _GU_LAZY=yes
    fi
  fi
  [ "$_GU_LAZY" = yes ]
}

# git with no GIT_* variable from the caller, and the ones this file sets.
_gu_env_run() (
  local name
  for name in $(compgen -e); do
    case "$name" in GIT_*) unset "$name" 2>/dev/null || true ;; esac
  done
  explicit_head_env && export GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0 GIT_NO_LAZY_FETCH=1
  export GIT_NO_REPLACE_OBJECTS=1 GIT_GRAFT_FILE=/dev/null/none
  command git "$@"
)

_gu_git() {
  local lazy=() promisor='^(extensions\.partialclone|remote\..*\.promisor)$'
  if _gu_lazy_flag; then
    lazy=(--no-lazy-fetch)
  elif _gu_env_run config --get-regexp "$promisor" >/dev/null 2>&1; then
    _gu_refuse "a promisor remote is configured and this git predates --no-lazy-fetch (2.44)"
    return 2
  fi
  _gu_env_run --no-pager --no-optional-locks --literal-pathspecs ${lazy[@]+"${lazy[@]}"} \
    -c core.fsmonitor=false -c core.hooksPath=/dev/null -c log.showSignature=false \
    -c gpg.program=/dev/null/none -c gpg.openpgp.program=/dev/null/none \
    -c gpg.ssh.program=/dev/null/none -c gpg.x509.program=/dev/null/none \
    -c submodule.recurse=false -c diff.submodule=short --no-replace-objects "$@"
}

# The flags every form that diffs carries: no textconv, no external diff, no color.
_GU_PLAIN=(--no-textconv --no-ext-diff --no-color)

gu_names() {
  [ $# -eq 2 ] || { _gu_refuse "names takes <a> <b>"; return 2; }
  _gu_need_rev "$1" && _gu_need_rev "$2" || return 2
  _gu_git diff --name-only "${_GU_PLAIN[@]}" --end-of-options "$1" "$2" --
}

gu_patch() {
  [ $# -ge 2 ] || { _gu_refuse "patch takes <a> <b> [<path>...]"; return 2; }
  _gu_need_rev "$1" && _gu_need_rev "$2" || return 2
  local a="$1" b="$2" && shift 2
  _gu_need_paths "$@" || return 2
  _gu_git diff "${_GU_PLAIN[@]}" --end-of-options "$a" "$b" -- "$@"
}

gu_log() {
  [ $# -ge 1 ] && [ $# -le 2 ] || { _gu_refuse "log takes <a>..<b> | <rev> [<n>]"; return 2; }
  case "$1" in
    *..*) _gu_range "$1" || { _gu_refuse "not a two-dot range of revisions: $1"; return 2; } ;;
    *) _gu_need_rev "$1" || return 2 ;;
  esac
  local max=()
  if [ $# -eq 2 ]; then
    _gu_count "$2" || { _gu_refuse "not a count: $2"; return 2; }
    max=("--max-count=$2")
  fi
  _gu_git log ${max[@]+"${max[@]}"} --format='%h %s' --no-notes "${_GU_PLAIN[@]}" \
    --end-of-options "$1" --
}

gu_show() {
  [ $# -eq 2 ] || { _gu_refuse "show takes <rev> --stat|--no-patch"; return 2; }
  _gu_need_rev "$1" || return 2
  [ "$2" = --stat ] || [ "$2" = --no-patch ] ||
    { _gu_refuse "show takes --stat or --no-patch, not: $2"; return 2; }
  _gu_git show "$2" --format=medium --no-notes "${_GU_PLAIN[@]}" --end-of-options "$1" --
}

gu_files() {
  [ $# -le 1 ] || { _gu_refuse "files takes [<path>]"; return 2; }
  _gu_need_paths "$@" || return 2
  [ -n "$EXPLICIT_HEAD" ] || { _gu_git ls-files -- "$@"; return; }
  # No `--`: after --end-of-options, ls-tree takes it for a path, and lists nothing.
  _gu_git ls-tree -r --name-only --end-of-options "$EXPLICIT_HEAD" "$@"
}

gu_grep() {
  [ $# -ge 2 ] || { _gu_refuse "grep takes <pattern> <rev> [<path>...]"; return 2; }
  [ -n "$1" ] || { _gu_refuse "an empty pattern"; return 2; }
  _gu_need_rev "$2" || return 2
  local pattern="$1" rev="$2" && shift 2
  _gu_need_paths "$@" || return 2
  _gu_git grep -n -I -F --no-textconv --no-color -e "$pattern" --end-of-options "$rev" -- "$@"
}

gu_base() {
  [ $# -eq 1 ] || { _gu_refuse "base takes <rev>"; return 2; }
  _gu_need_rev "$1" || return 2
  _gu_git merge-base --end-of-options "${EXPLICIT_HEAD:-HEAD}" "$1"
}

# The patch of every changed file _scope_globs.sh counts as a manifest, in a new
# temp file outside the repository; it prints that path and the count, so no file
# name reaches a command line. The names come from git (NUL-separated) and go
# after `--` as they are: --literal-pathspecs keeps each one a path.
gu_manifests() {
  [ $# -eq 2 ] || { _gu_refuse "manifests takes <a> <b>"; return 2; }
  _gu_need_rev "$1" && _gu_need_rev "$2" || return 2
  local out names f rc=0 picked=()
  out="$(mktemp "${TMPDIR:-/tmp}/git-read-manifests.XXXXXX")" || return 1
  names="$(mktemp "${TMPDIR:-/tmp}/git-read-names.XXXXXX")" || return 1
  _gu_git diff --name-only -z "${_GU_PLAIN[@]}" --end-of-options "$1" "$2" -- >"$names" || rc=$?
  while IFS= read -r -d '' f; do
    matches_any "$f" "${SCOPE_DEP_GLOBS[@]}" && picked+=("$f")
  done <"$names"
  rm -f "$names"
  # None changed: the file stays empty, since a patch naming no path is the whole diff.
  if [ "$rc" -eq 0 ] && [ ${#picked[@]} -gt 0 ]; then
    _gu_git diff "${_GU_PLAIN[@]}" --end-of-options "$1" "$2" -- "${picked[@]}" >"$out" || rc=$?
  fi
  [ "$rc" -eq 0 ] || { rm -f "$out" && return "$rc"; }
  printf 'MANIFESTS_FILE: %s\nMANIFESTS: %s\n' "$out" "${#picked[@]}"
}
