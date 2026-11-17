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
case "$input" in *review*) ;; *) exit 0 ;; esac
# A start, as startsReview (src/domain/review_gate.ts) reads one, its blanks as JSON escapes them
# too: wider than the binary's, never narrower.
start='review([[:space:]]|\\[nrt\\])+start'
[[ -z $dropped || ! $input =~ $start ]] || refuse "VERIFIER REFUSED: $dropped$without"
if ! resolve_sn; then
  [ -z "$why" ] || refuse "VERIFIER REFUSED: $why"
  exit 0
fi
cd "$dir" || refuse "cannot enter the project folder"
printf '%s' "$input" | "$sn" review gate && exit 0
exit 2
