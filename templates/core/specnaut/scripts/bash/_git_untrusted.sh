# shellcheck shell=bash
# _git_untrusted.sh - git with hardened defaults, for reading a repository whose
# configuration nobody vetted. Sourced, never run: git-read.sh is its command
# line, and collect-audit-scope.sh sources it beside itself.
#
# The one home of how git reads such a repository. Every call drops the GIT_*
# environment and runs with these defaults, each turning off a program or a
# redirection the repository's own configuration could otherwise name:
#
#   --no-pager --no-optional-locks --literal-pathspecs --no-lazy-fetch
#   -c core.fsmonitor=false           no fsmonitor program
#   -c core.hooksPath=/dev/null       no hook
#   -c log.showSignature=false        and every gpg.*program a path that cannot
#                                     exist: no signature program, for any format
#   -c submodule.recurse=false -c diff.submodule=short
#   --no-textconv --no-ext-diff --no-color on every form that diffs
#
# --no-lazy-fetch needs git 2.44. Below it, a repository that names a promisor
# remote is refused rather than read, since reading a missing object would fetch it.
#
# The forms take data only - revisions, paths, a fixed-string pattern, a count -
# never a git option, and each runs one fixed command line. They read objects and
# the index, never the work tree, so no clean or smudge filter applies either.
#
#   gu_names <a> <b>               files that differ between two revisions
#   gu_patch <a> <b> [<path>...]   the patch between two revisions
#   gu_log <a>..<b> | <rev> [<n>]  one line per commit: short hash, subject
#   gu_show <rev> --stat|--no-patch
#   gu_files [<path>]              tracked files, under <path> when given
#   gu_grep <pattern> <rev> [<path>...]
#   gu_base <rev>                  the merge base of HEAD and <rev>
#
# A refused argument prints "git-read: refused: <why>" and returns 2.
# _gu_git runs a fixed argv under the same defaults; it is for this file and for
# scripts that source it, never for an argv someone else composed.

# A revision: ref-name characters only, never an option, never a range. `+` is
# there for a tag carrying SemVer build metadata (v1.0.0+build.7).
_gu_rev() {
  case "$1" in
    '' | -* | *..*) return 1 ;;
  esac
  printf '%s' "$1" | grep -Eq '^[A-Za-z0-9._/@^~+-]+$'
}

# A path: relative, inside the tree, forward slashes.
_gu_path() {
  case "$1" in
    '' | /* | [A-Za-z]:* | *\\* | .. | ../* | */../* | */..) return 1 ;;
  esac
  return 0
}

_gu_refuse() {
  echo "git-read: refused: $1" >&2
  return 2
}

_gu_need_rev() { _gu_rev "$1" || _gu_refuse "not a revision: $1"; }

_gu_need_paths() {
  local p
  for p in "$@"; do
    _gu_path "$p" || {
      _gu_refuse "not a relative path inside the tree: $p"
      return 2
    }
  done
}

# True when this git knows --no-lazy-fetch (2.44 or later). Cached.
_gu_lazy_flag() {
  if [ -z "${_GU_LAZY:-}" ]; then
    local v major minor
    v="$(_gu_env_run version 2>/dev/null)" || v=""
    if [[ "$v" =~ ([0-9]+)\.([0-9]+) ]]; then
      major="${BASH_REMATCH[1]}"
      minor="${BASH_REMATCH[2]}"
      if [ "$major" -gt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -ge 44 ]; }; then
        _GU_LAZY=yes
      else
        _GU_LAZY=no
      fi
    else
      _GU_LAZY=no
    fi
  fi
  [ "$_GU_LAZY" = yes ]
}

# git with no GIT_* variable from the caller, and the three this file sets.
_gu_env_run() (
  local name
  for name in $(compgen -e); do
    case "$name" in GIT_*) unset "$name" 2>/dev/null || true ;; esac
  done
  export GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0 GIT_NO_LAZY_FETCH=1
  command git "$@"
)

_gu_git() {
  local lazy=()
  if _gu_lazy_flag; then
    lazy=(--no-lazy-fetch)
  elif _gu_env_run config --get-regexp '^(extensions\.partialclone|remote\..*\.promisor)$' >/dev/null 2>&1; then
    _gu_refuse "a promisor remote is configured and this git predates --no-lazy-fetch (2.44)"
    return 2
  fi
  _gu_env_run --no-pager --no-optional-locks --literal-pathspecs ${lazy[@]+"${lazy[@]}"} \
    -c core.fsmonitor=false -c core.hooksPath=/dev/null -c log.showSignature=false \
    -c gpg.program=/dev/null/none -c gpg.openpgp.program=/dev/null/none \
    -c gpg.ssh.program=/dev/null/none -c gpg.x509.program=/dev/null/none \
    -c submodule.recurse=false -c diff.submodule=short "$@"
}

gu_names() {
  [ $# -eq 2 ] || { _gu_refuse "names takes <a> <b>"; return 2; }
  _gu_need_rev "$1" && _gu_need_rev "$2" || return 2
  _gu_git diff --name-only --no-textconv --no-ext-diff --no-color --end-of-options "$1" "$2" --
}

gu_patch() {
  [ $# -ge 2 ] || { _gu_refuse "patch takes <a> <b> [<path>...]"; return 2; }
  _gu_need_rev "$1" && _gu_need_rev "$2" || return 2
  local a="$1" b="$2"
  shift 2
  _gu_need_paths "$@" || return 2
  _gu_git diff --no-textconv --no-ext-diff --no-color --end-of-options "$a" "$b" -- "$@"
}

gu_log() {
  [ $# -ge 1 ] && [ $# -le 2 ] || { _gu_refuse "log takes <a>..<b> | <rev> [<n>]"; return 2; }
  local spec="$1"
  case "$spec" in
    *...*) _gu_refuse "a three-dot range: $spec"; return 2 ;;
    *..*) _gu_need_rev "${spec%%..*}" && _gu_need_rev "${spec#*..}" || return 2 ;;
    *) _gu_need_rev "$spec" || return 2 ;;
  esac
  local max=()
  if [ $# -eq 2 ]; then
    printf '%s' "$2" | grep -Eq '^[1-9][0-9]*$' || { _gu_refuse "not a count: $2"; return 2; }
    max=("--max-count=$2")
  fi
  _gu_git log ${max[@]+"${max[@]}"} --format='%h %s' --no-notes --no-textconv --no-ext-diff --no-color \
    --end-of-options "$spec" --
}

gu_show() {
  [ $# -eq 2 ] || { _gu_refuse "show takes <rev> --stat|--no-patch"; return 2; }
  _gu_need_rev "$1" || return 2
  case "$2" in
    --stat | --no-patch) ;;
    *) _gu_refuse "show takes --stat or --no-patch, not: $2"; return 2 ;;
  esac
  _gu_git show "$2" --format=medium --no-notes --no-textconv --no-ext-diff --no-color \
    --end-of-options "$1" --
}

gu_files() {
  [ $# -le 1 ] || { _gu_refuse "files takes [<path>]"; return 2; }
  _gu_need_paths "$@" || return 2
  _gu_git ls-files -- "$@"
}

gu_grep() {
  [ $# -ge 2 ] || { _gu_refuse "grep takes <pattern> <rev> [<path>...]"; return 2; }
  [ -n "$1" ] || { _gu_refuse "an empty pattern"; return 2; }
  _gu_need_rev "$2" || return 2
  local pattern="$1" rev="$2"
  shift 2
  _gu_need_paths "$@" || return 2
  _gu_git grep -n -I -F --no-textconv --no-color -e "$pattern" --end-of-options "$rev" -- "$@"
}

gu_base() {
  [ $# -eq 1 ] || { _gu_refuse "base takes <rev>"; return 2; }
  _gu_need_rev "$1" || return 2
  _gu_git merge-base --end-of-options HEAD "$1"
}
