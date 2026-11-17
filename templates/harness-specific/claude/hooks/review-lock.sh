#!/usr/bin/env bash
# Runs before every tool call. Once a session has started a review of a branch
# it cannot trust (`specnaut review start`), it is under the review lock until it
# ends: only what `specnaut review guard` allows runs. The binary judges (it
# reads this hook's input on stdin, and says what the lock allows); this script
# only finds out, cheaply, whether a lock can hold for this call.
#
# Exit 2 stops the call and shows the session why; 0 lets it run. The locks live
# in `<git dir>/specnaut/review-lock/<session id>.json`, and each one's copy in
# `$XDG_STATE_HOME/specnaut/review-lock/` (`~/.local/state` without it), which
# needs no repository to be found. With neither there the call runs without
# starting the binary, and so does a call whose input opens with a session id
# that holds none: Claude Code writes `session_id` first, and any other input
# goes to the binary. A session whose copy is there while git cannot find the
# checkout's git directory is refused, and so is one whose copy cannot be told
# absent (a file, or a folder the hook may not search, on the way to it), which
# the binary refuses too; so is any call in a repository git cannot be asked
# about once the hook dropped an entry of the PATH, which may have been git's.
# The input is read by a builtin: the session id never depends on the PATH. A lock with no `specnaut` on PATH to judge it stops
# the call, and so does one whose PATH held an entry the hook dropped, or whose
# `specnaut` resolves into the tree: the lock is not judged by what the tree
# may have supplied.
refuse() {
  echo "review-lock: $1" >&2
  exit 2
}
# The refusal naming the entry clean_path dropped, when it dropped one.
refuse_dropped() {
  [ -z "$dropped" ] || refuse "VERIFIER REFUSED: $dropped - start the session from a shell without that entry"
}
dir=$(cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null && pwd -P) ||
  refuse "cannot enter the project folder"
# The PATH, cleaned before the first command it names runs. An empty or a relative entry is searched
# from the working folder, and an entry in the tree finds what a branch put there, so either could
# supply `git`, `cat` or `specnaut` itself. The hook drops such entries rather than refuse: it runs
# before every call of every session, review or not, and removal gives the same guarantee. The rule
# of phases/script-gate.md § Resolving the verifier and of _verifier.sh; one test runs all of them.
# Builtins only until PATH is exported: git is one of the commands it judges.

# The top of the tree $1 is in, into `top`: the nearest folder at or above it holding a `.git`,
# found without git. Empty with none.
tree_top() {
  local d=$1
  top=""
  while :; do
    if [ -e "$d/.git" ]; then
      top=${d:-/}
      return 0
    fi
    [ -n "$d" ] || return 0
    d=${d%/*}
  done
}

# Whether PATH entry $1 can supply a command from the tree, its reason into `why`: empty, not
# absolute, a `.` or `..` component, or in the tree under `top`.
entry_unsafe() {
  why=""
  case $1 in "") why="is empty" ;; /*) ;; *) why="is not an absolute path" ;; esac
  case /$1/ in */./* | */../*) [ -n "$why" ] || why="has a . or .. component" ;; esac
  [ -n "$why" ] || entry_in_tree "$1"
}

# Whether $1, or a folder above it as it is spelled, is the top: `-ef` compares device and inode,
# so neither case nor a spelling hides it.
under_top() {
  local a=$1
  while [ "$a" != / ] && ! [ "$a" -ef "$top" ]; do a=${a%/*}; a=${a:-/}; done
  [ "$a" -ef "$top" ]
}

# Whether the absolute entry $1 is in the tree, `why` naming how. Spelled in the tree, it is in it:
# a link there points where the branch says. Else its longest part that is there is entered with
# `cd -P`, every link on it followed - a link to a folder of the tree is in the tree - and walked
# up the same way. A part that is there and cannot be entered (a file, a dangling link) could be
# made one: it counts in.
entry_in_tree() {
  local a=$1
  why="is inside the repository"
  under_top "$a" && return 0
  while ! [ -e "$a" ] && ! [ -L "$a" ]; do a=${a%/*}; a=${a:-/}; done
  if ! a=$(cd -P "$a" 2>/dev/null && pwd); then
    why="names a folder that cannot be entered"
    return 0
  fi
  under_top "$a" && return 0
  why=""
  return 1
}

# PATH rebuilt from the entries the rule keeps, in order, and exported, so every command of this
# hook and the binary it starts resolve on it; the first entry dropped, and why, into `dropped`.
# With none kept, `/dev/null`: an empty PATH is searched from the working folder.
clean_path() {
  local rest=${PATH-}: e kept=""
  dropped=""
  while [ -n "$rest" ]; do
    e=${rest%%:*}
    rest=${rest#*:}
    if ! entry_unsafe "$e"; then
      kept=${kept:+$kept:}$e
    elif [ -z "$dropped" ]; then
      dropped="PATH entry '$e' $why"
    fi
  done
  export PATH=${kept:-/dev/null}
}

# `specnaut`, into `sn`, as _verifier.sh's resolve_specnaut resolves it: the physical file, each
# link followed one hop at a time, neither its folder nor a link on the way in the tree. A refusal
# leaves `why` naming the path and the reason; no `specnaut` on the PATH leaves it empty.
resolve_sn() {
  local p d t n=0
  sn="" why=""
  p=$(command -v specnaut) || return 1
  case $p in /*) ;; *) why="is not an absolute path" ;; esac
  while [ -z "$why" ]; do
    if ! d=$(cd -P "${p%/*}/" && pwd); then why="names a folder that cannot be entered"; break; fi
    p="$d/${p##*/}"
    if under_top "$d"; then why="is inside the repository"; break; fi
    if ! [ -L "$p" ]; then sn=$p; return 0; fi
    n=$((n + 1)); if [ "$n" -gt 40 ]; then why="links more than 40 times"; break; fi
    if ! t=$(readlink "$p"); then why="is a link that cannot be read"; break; fi
    case $t in /*) p=$t ;; *) p="$d/$t" ;; esac
  done
  why="$p $why"
  return 1
}
tree_top "$dir"
top=${top:-$dir}
clean_path
IFS= read -r -d '' input || true
# The same pattern as isSessionId (src/domain/session_record.ts).
id_pattern='^\{"session_id":"([A-Za-z0-9][A-Za-z0-9_-]{0,127})"'
id=""
[[ $input =~ $id_pattern ]] && id=${BASH_REMATCH[1]}
# Whether $1 is a path the binary reads as absolute: on a Windows shell a drive
# letter starts one too (isAbsolute there), its backslashes read as slashes.
absolute() {
  case "$1" in /*) return 0 ;; esac
  case "${OSTYPE:-}" in msys* | cygwin*) case "$1" in [A-Za-z]:[\\/]*) return 0 ;; esac ;; esac
  return 1
}
# Whether nothing is at $1 for certain: the nearest path above it that is there
# is a folder this hook may search. A file, a folder it may not search, or no
# folder at all on the way proves no absence: the binary refuses such a path.
absent() {
  local up=$1
  while [ ! -e "$up" ]; do
    case "$up" in */*) up=${up%/*} ;; *) return 1 ;; esac
    [ -n "$up" ] || up=/
  done
  [ -d "$up" ] && [ -x "$up" ]
}
# The per-user copy, found as reviewLockStateFolder finds it.
state=${XDG_STATE_HOME:-}
absolute "$state" || state="${HOME:-}/.local/state"
case "${OSTYPE:-}" in msys* | cygwin*) state=${state//\\//} ;; esac
mine=0
if [ -n "$id" ] && absolute "$state"; then
  copies="$state/specnaut/review-lock"
  if [ -e "$copies" ] || [ -L "$copies" ]; then
    if [ ! -d "$copies" ] || [ -L "$copies" ] || [ ! -x "$copies" ] ||
      [ -e "$copies/$id.json" ] || [ -L "$copies/$id.json" ]; then mine=1; fi
  elif ! absent "$copies"; then
    mine=1
  fi
fi
# Git is asked as the binary asks it (UNTRUSTED_GIT_ENV, ENV_ALLOWLIST in
# src/infrastructure/untrusted_git.ts): none of the caller's GIT_* variables.
vars=(GIT_CONFIG_NOSYSTEM=1)
for name in PATH HOME XDG_CONFIG_HOME TMPDIR LANG LC_ALL LC_CTYPE USERPROFILE HOMEDRIVE HOMEPATH SYSTEMROOT WINDIR COMSPEC PATHEXT TEMP TMP; do
  [ -n "${!name+x}" ] && vars+=("$name=${!name}")
done
git_dir=$(cd "$dir" && env -i "${vars[@]}" git rev-parse --absolute-git-dir 2>/dev/null) || {
  [ ! -e "$top/.git" ] || refuse_dropped
  [ "$mine" = 0 ] ||
    refuse "this session is under the review lock, and git cannot find this checkout's git directory"
  exit 0
}
# The checkout's lock, or the session's own entry in it, lets the call run
# only when `absent` proves it is not there; what the hook cannot look into
# goes to the binary.
if [ "$mine" = 0 ]; then
  locks="$git_dir/specnaut/review-lock"
  [ -e "$locks" ] || [ -L "$locks" ] || ! absent "$locks" || exit 0
  if [ -d "$locks" ] && [ ! -L "$locks" ] && [ -n "$id" ]; then
    own="$locks/$id.json"
    [ -e "$own" ] || [ -L "$own" ] || ! absent "$own" || exit 0
  fi
fi
refuse_dropped
if ! resolve_sn; then
  [ -z "$why" ] || refuse "VERIFIER REFUSED: $why"
  refuse "a review lock is held here and specnaut is not on PATH to judge this call"
fi
cd "$dir" || refuse "cannot enter the project folder"
printf '%s' "$input" | "$sn" review guard && exit 0
exit 2
