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
# the binary refuses too. A lock with no `specnaut` on PATH to judge it stops
# the call.
input=$(cat)
refuse() {
  echo "review-lock: $1" >&2
  exit 2
}
dir=$(cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null && pwd -P) ||
  refuse "cannot enter the project folder"
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
command -v specnaut >/dev/null 2>&1 ||
  refuse "a review lock is held here and specnaut is not on PATH to judge this call"
cd "$dir" || refuse "cannot enter the project folder"
printf '%s' "$input" | specnaut review guard && exit 0
exit 2
