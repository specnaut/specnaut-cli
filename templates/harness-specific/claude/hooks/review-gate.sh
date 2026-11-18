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
# `specnaut` on the cleaned PATH (below), nothing is stopped here: `specnaut
# review start` cannot run either - unless the hook dropped an entry, as the
# start runs on the session's own PATH, where that entry could supply the
# `specnaut` performing it; a line that starts a review is then refused. Before
# any of that, every time, the pass a gated line left is removed: a pass lives
# only until the next command, and a check stopped part-way leaves none behind.
# A `specnaut` that resolves into the tree stops a review's command: it would
# be the tree judging itself. The input is read by a builtin, PATH or none.
refuse() {
  echo "review-gate: $1" >&2
  exit 2
}
dir=$(cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null && pwd -P) ||
  refuse "cannot enter the project folder"
# The PATH rule - tree_top, clean_path, resolve_cmd - from _clean-path.sh beside this file, by its
# path: nothing is looked up before the PATH is cleaned.
lib=${BASH_SOURCE[0]%/*}
[ "$lib" != "${BASH_SOURCE[0]}" ] || lib=.
# shellcheck source-path=SCRIPTDIR source=_clean-path.sh
. "$lib/_clean-path.sh" || refuse "cannot read $lib/_clean-path.sh"
# Removes the pass where git keeps it. When git cannot say where that is (a
# repository it refuses to read, say), the `.git` above the folder does; a
# folder with none holds no pass. One whose git directory still cannot be
# found might: the command is stopped, never let through.
drop_pass() {
  local git_dir
  git_dir=$(cd "$dir" && git rev-parse --absolute-git-dir 2>/dev/null) ||
    git_dir=$(git_dir_above "$dir") || return 0
  [ -n "$git_dir" ] && [ -d "$git_dir" ] ||
    refuse "cannot find the git directory of the project folder"
  rm -f -- "$git_dir/specnaut/review-pass.json" ||
    refuse "cannot remove the review pass${dropped:+ - VERIFIER REFUSED: $dropped$without}"
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
tree_top "$dir"
top=${top:-$dir}
clean_path
without=" - start the session from a shell without that entry"
IFS= read -r -d '' input || true
drop_pass
# The line with every line continuation, quote and backslash removed, JSON-escaped or not, as the
# shell removes them before `specnaut` reads its words: `"review" start`, `re"vi"ew st'ar't`,
# `review\ start` and `rev\<newline>iew start` read as the start they run.
flat=${input//\\\\\\n/}
flat=${flat//\\\\/}
flat=${flat//\\\"/}
flat=${flat//\'/}
case "$flat" in *review*) ;; *) exit 0 ;; esac
# A start, as startsReview (src/domain/review_gate.ts) reads one, its blanks as JSON escapes them
# too: wider than the binary's, never narrower.
start='review([[:space:]]|\\[nrt\\])+start'
[[ -z $dropped || ! $flat =~ $start ]] || refuse "VERIFIER REFUSED: $dropped$without"
if ! resolve_cmd specnaut; then
  [ -z "$why" ] || refuse "VERIFIER REFUSED: $why"
  exit 0
fi
cd "$dir" || refuse "cannot enter the project folder"
printf '%s' "$input" | "$cmd" review gate && exit 0
exit 2
