# shellcheck shell=bash disable=SC2154 # base and the digests: set by the sourcing script
# HEAD's verdict from the verifier, for land-feature.sh - sourced, never run,
# after it set its git alias, under its `set -Eeuo pipefail` and ERR trap;
# `base`, `scripts_digest` and `instructions_digest` are set before the calls.
# Exit 13 is land-feature.sh's: its header says what the code means.

# The PATH, judged before the first command it names runs - `bash`, `git` and `specnaut` are all
# looked up on it. An empty or a relative entry is searched from the working folder, and an entry
# in the tree finds what the branch put there, so either can supply any command: the first one is
# refused by name. Builtins only, git included: it is one of those commands. The rule of
# phases/script-gate.md § Resolving the verifier and of the Claude Code hooks; one test runs all.
refuse_unsafe_path() {
  local rest=${PATH-}: e top why
  tree_top "$(pwd -P)"
  if [ -z "$top" ]; then
    echo "land-feature: VERIFIER REFUSED: specnaut has no repository to be judged outside of - could not judge HEAD, nothing was landed" >&2
    exit 13
  fi
  while [ -n "$rest" ]; do
    e=${rest%%:*}
    rest=${rest#*:}
    entry_unsafe "$e" || continue
    echo "land-feature: VERIFIER REFUSED: PATH entry '$e' $why - start the session from a shell without that entry. Nothing was landed" >&2
    exit 13
  done
}

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

# Whether the absolute entry $1 is in the tree, `why` naming how. Its longest part that is there
# is entered with `cd -P`, every link on it followed - a link to a folder of the tree is in the
# tree - and walked up against the top by `-ef`, so neither case nor a spelling hides it. A part
# that is there and cannot be entered (a file, a dangling link) could be made one: it counts in.
entry_in_tree() {
  local a=$1
  while ! [ -e "$a" ] && ! [ -L "$a" ]; do
    a=${a%/*}
    a=${a:-/}
  done
  if ! a=$(cd -P "$a" 2>/dev/null && pwd); then
    why="names a folder that cannot be entered"
    return 0
  fi
  while [ "$a" != / ] && ! [ "$a" -ef "$top" ]; do
    a=${a%/*}
    a=${a:-/}
  done
  [ "$a" -ef "$top" ] || return 1
  why="is inside the repository"
}

# The verifier, resolved before it runs, into `sn`: `specnaut` on the PATH must be an absolute
# path, and neither its folder nor any link on the way to it may sit in this repository - the PATH
# can name a folder of the tree, where the branch being landed puts a `specnaut` of its own. Each
# link is followed one hop at a time to the physical file; `-ef` compares device and inode, so
# neither case, a drive-letter spelling nor a `<repo>-x` sibling passes for the repository. The
# rule of phases/script-gate.md § Resolving the verifier, which runs before any script of the tree
# is trusted, so the two spell it apart; one test runs both against the same cases.
resolve_specnaut() {
  local p why="" n=0 d a t top
  p=$(command -v specnaut) || p=""
  top=$(git rev-parse --show-toplevel) || top=""
  case $p in /*) ;; "") why="is not on the PATH" ;; *) why="is not an absolute path" ;; esac
  [ -n "$why" ] || [ -n "$top" ] || why="has no repository to be judged outside of"
  while [ -z "$why" ]; do
    if ! d=$(cd -P "${p%/*}/" && pwd); then why="names a folder that cannot be entered"; break; fi
    p="$d/${p##*/}"; a=$d
    while [ "$a" != / ] && ! [ "$a" -ef "$top" ]; do a=${a%/*}; a=${a:-/}; done
    if [ "$a" -ef "$top" ]; then why="is inside the repository"; break; fi
    if ! [ -L "$p" ]; then sn=$p; return 0; fi
    n=$((n + 1)); if [ "$n" -gt 40 ]; then why="links more than 40 times"; break; fi
    if ! t=$(readlink "$p"); then why="is a link that cannot be read"; break; fi
    case $t in /*) p=$t ;; *) p="$d/$t" ;; esac
  done
  echo "land-feature: VERIFIER REFUSED: ${p:-specnaut} $why - could not judge HEAD, nothing was landed" >&2
  exit 13
}

# The verifier's answer on HEAD, into `out`, given the flags; exit 13 when it is no answer for this
# base: an exit past 1, no instructions digest, or another base's name.
ask_verifier() {
  local rc=0 names
  out=$("$sn" verify-scripts "$@") || rc=$?
  names=$(sed -n 's/^NAMES_FILE //p' <<<"$out")
  [ -z "$names" ] || rm -f "$names"
  if [ "$rc" -gt 1 ] || ! grep -qE '^INSTRUCTIONS_DIGEST [0-9a-f]{64}$' <<<"$out" ||
    ! grep -qxF "BASE_BRANCH $base" <<<"$out"; then
    echo "land-feature: the verifier could not judge HEAD (exit $rc) - nothing was landed" >&2
    exit 13
  fi
}

# Whether the scripts let HEAD land: trusted, or held by the digest passed. With none, the one
# reason allowed is a local base ahead of origin, which the landing stops on itself (exit 6); a
# script or the lock at base the branch changed is not landed without a yes.
scripts_hold() {
  local others
  [ "$(sed -n '$p' <<<"$out")" = "VERDICT scripts trusted" ] && return 0
  if [ -n "$scripts_digest" ]; then
    grep -q '^APPROVAL scripts holds ' <<<"$out"
    return
  fi
  others=$(grep '^UNTRUSTED ' <<<"$out" | grep -vxF "UNTRUSTED refs/heads/$base local $base ahead of origin") || true
  [ -z "$others" ] && grep -q '^UNTRUSTED ' <<<"$out"
}

# HEAD's verdict, from the binary, each digest held passed on as its flag: return 0, or exit 13.
# The binary compares the digests; this reads its lines. The instructions must be trusted or held.
judge_head() {
  local ok=1 flags=()
  [ -z "$scripts_digest" ] || flags+=(--approved-scripts "$scripts_digest")
  [ -z "$instructions_digest" ] || flags+=(--approved-instructions "$instructions_digest")
  ask_verifier ${flags[@]+"${flags[@]}"}
  scripts_hold || ok=0
  grep -qx 'VERDICT instructions trusted' <<<"$out" ||
    { [ -n "$instructions_digest" ] && grep -q '^APPROVAL instructions holds ' <<<"$out"; } || ok=0
  [ "$ok" = 0 ] || return 0
  grep -E '^(VERDICT instructions |UNTRUSTED |APPROVAL )' <<<"$out" >&2 || true
  if [ -n "$scripts_digest" ] && grep -qxF "APPROVAL scripts moved $scripts_digest" <<<"$out"; then
    echo "land-feature: HEAD's helper scripts hold a reason no yes can cover - stop on it. Nothing was landed" >&2
  else
    echo "land-feature: HEAD's instructions or helper scripts are neither trusted nor the digest passed - ask, then land again with it. Nothing was landed" >&2
  fi
  exit 13
}
