#!/usr/bin/env bash
# Runs before each shell command. A command that starts a review of a branch
# the session cannot trust (`specnaut review start`) runs only when the
# session's checkout holds, judged against the record this session's start
# took: the binary does the work (`specnaut review gate` reads this hook's
# input on stdin, and says which commands it judges); this script only calls it.
#
# Exit 2 stops the command and shows the session why; 0 lets it run, and what
# the gate prints is this hook's answer: for a line it passes, the line
# rewritten to carry the pass's nonce, the one line the start takes it from.
# Input that
# never mentions a review is let through without starting the binary. With no
# `specnaut` on PATH, `specnaut review start` cannot run either, so nothing is
# stopped here. Before any of that, every time, the pass a gated line left is
# removed: a pass lives only until the next command, and a check stopped
# part-way leaves none behind.
input=$(cat)
refuse() {
  echo "review-gate: $1" >&2
  exit 2
}
# Removes the pass where git keeps it. When git cannot say where that is (a
# repository it refuses to read, say), the `.git` above the folder does; a
# folder with none holds no pass. One whose git directory still cannot be
# found might: the command is stopped, never let through.
drop_pass() {
  local dir git_dir
  dir=$(cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null && pwd -P) ||
    refuse "cannot enter the project folder"
  git_dir=$(cd "$dir" && git rev-parse --absolute-git-dir 2>/dev/null) ||
    git_dir=$(git_dir_above "$dir") || return 0
  [ -n "$git_dir" ] && [ -d "$git_dir" ] ||
    refuse "cannot find the git directory of the project folder"
  rm -f -- "$git_dir/specnaut/review-pass.json" ||
    refuse "cannot remove the review pass"
}
# The git directory of the repository $1 is in, read without git: a `.git`
# folder, or the one a `.git` file names (empty when it names none). Fails
# when no `.git` is above $1.
git_dir_above() {
  local dir=$1 up line=
  while :; do
    if [ -d "$dir/.git" ]; then
      printf '%s' "$dir/.git"
      return 0
    elif [ -e "$dir/.git" ]; then
      { IFS= read -r line <"$dir/.git"; } 2>/dev/null
      line=${line%$'\r'}
      case "$line" in "gitdir: "?*) line=${line#gitdir: } ;; *) return 0 ;; esac
      case "$line" in /* | [A-Za-z]:*) ;; *) line="$dir/$line" ;; esac
      printf '%s' "$line"
      return 0
    fi
    up=$(dirname "$dir")
    [ "$up" = "$dir" ] && return 1
    dir=$up
  done
}
drop_pass
case "$input" in *review*) ;; *) exit 0 ;; esac
command -v specnaut >/dev/null 2>&1 || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || refuse "cannot enter the project folder"
printf '%s' "$input" | specnaut review gate && exit 0
exit 2
