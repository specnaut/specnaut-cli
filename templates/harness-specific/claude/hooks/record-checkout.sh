#!/usr/bin/env bash
# Records the checkout this session started on: HEAD and the instruction and
# config files the harness has just loaded, so a later check judges what the
# session loaded rather than what the folder holds by then. The binary does the
# work (`specnaut record-checkout` reads this hook's input on stdin and says
# which sources take a record); this script only calls it.
#
# With no `specnaut` on PATH, or one that resolves into the tree, nothing is
# recorded, and a check that needs the record refuses. Always exits 0 and
# prints nothing on stdout: a SessionStart hook's stdout is added to the
# session's context.
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
dir=$(pwd -P)
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
resolve_sn || exit 0
"$sn" record-checkout >/dev/null || true
exit 0
