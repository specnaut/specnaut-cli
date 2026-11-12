# shellcheck shell=bash
# Sourced by run-gate.sh and gate-impact.sh, and the one home of what a candidate
# is: a tree and the commit that holds it. A pass is a statement about one exact
# tree, so a tree that is dirty, or that moved during the run, is refused rather
# than presented as tested.
#
# Requires REPO_ROOT. Every git call goes through gate_git: this runs inside hooks,
# where git has exported GIT_DIR and friends pointing at someone else's view of
# the repository.
#
# Given a head (gate_candidate_head, _explicit_head.sh), the candidate is that
# commit, read from git's objects by its id: never HEAD, the index or a work tree,
# so it cannot dirty or move, and nothing on disk is taken for it.

# shellcheck source=SCRIPTDIR/_explicit_head.sh disable=SC1091
. "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/_explicit_head.sh" || return 70
GATE_LOCAL_ENV="$(git rev-parse --local-env-vars 2>/dev/null)"

# gate_git <git args...> - git on this repository, with the inherited repository
# variables gone and no filesystem monitor to start.
gate_git() {
  (
    for gate_var in $GATE_LOCAL_ENV; do unset "$gate_var"; done
    explicit_head_env
    git -C "$REPO_ROOT" -c core.fsmonitor=false "$@"
  )
}

# gate_ascii <text> - the text with anything but printable ASCII replaced, byte by
# byte. Causes and commands reach a line a legacy console prints, and a path may
# hold a newline, which would forge a record or a report line.
gate_ascii() {
  printf '%s' "$1" | LC_ALL=C tr -c ' -~' '?'
}

# gate_candidate_in_repo - true only at a work tree's top level. Inside another
# repository's tree, every path this mechanism reads would mean something else.
gate_candidate_in_repo() {
  local prefix
  prefix="$(gate_git rev-parse --is-inside-work-tree --show-prefix 2>/dev/null)" || return 1
  [ "$prefix" = "true" ]
}

# gate_candidate_head [--head <sha> [--objects <dir>]] - takes the head; with no
# argument, nothing changes. A refusal leaves its cause in EXPLICIT_REFUSAL and
# returns 1.
# shellcheck disable=SC2034  # EXPLICIT_REFUSAL is read by the script that calls this
gate_candidate_head() {
  local rc
  while [ "$#" -gt 0 ]; do
    rc=0 && explicit_head_option "$@" || rc=$?
    case $rc in
      0) shift 2 ;;
      2) return 1 ;;
      *) EXPLICIT_REFUSAL="usage: [--head <sha> [--objects <dir>]], not $1"; return 1 ;;
    esac
  done
  explicit_head_from_options gate_git || return 1
}

# gate_candidate_check <tree> - is the work tree still exactly <tree>? Prints the
# refusal and returns 1 when it is not. Status is read with the submodule flag
# the change set uses, so neither can see a change the other cannot. Given a head,
# the commit is asked instead: an id names one tree, whatever the disk holds.
gate_candidate_check() {
  local status head
  if [ -n "$EXPLICIT_HEAD" ]; then
    head="$(gate_git rev-parse --verify --quiet "$EXPLICIT_HEAD^{tree}" 2>/dev/null)" ||
      { echo "no-commit"; return 1; }
    [ "$head" = "$1" ] || { echo "tree-moved: $EXPLICIT_HEAD holds $head"; return 1; }
    return 0
  fi
  status="$(gate_git status --porcelain --untracked-files=all --ignore-submodules=none 2>/dev/null)" ||
    { echo "status-failed"; return 1; }
  if [ -n "$status" ]; then
    echo "dirty-tree: $(printf '%s\n' "$status" | wc -l | tr -d ' ') path(s) differ from the commit"
    return 1
  fi
  head="$(gate_git rev-parse --verify --quiet 'HEAD^{tree}' 2>/dev/null)" ||
    { echo "no-commit"; return 1; }
  if [ "$head" != "$1" ]; then
    echo "tree-moved: HEAD holds $head"
    return 1
  fi
  return 0
}

# gate_candidate_merge_base <name> - the merge-base of HEAD, or the head, and the default branch <name>,
# from the remote's copy when there is one, as that is where the branch will land.
gate_candidate_merge_base() {
  local ref
  for ref in "refs/remotes/origin/$1" "refs/heads/$1"; do
    gate_git rev-parse --verify --quiet "$ref" >/dev/null 2>&1 || continue
    gate_git merge-base "${EXPLICIT_HEAD:-HEAD}" "$ref" 2>/dev/null
    return $?
  done
  return 1
}

# gate_candidate_declares <path> <commit...> - does the work tree hold <path>, a link
# included, or does HEAD or a given commit? One deleted on the branch is a change,
# not a project that never opted in. Outside a repository only the tree is asked;
# given a head, the work tree is not, and the head stands for HEAD.
gate_candidate_declares() {
  local commit
  if [ -z "$EXPLICIT_HEAD" ]; then [ -e "$REPO_ROOT/$1" ] || [ -L "$REPO_ROOT/$1" ] && return 0; fi
  gate_candidate_in_repo || return 1
  for commit in "${EXPLICIT_HEAD:-HEAD}" "${@:2}"; do
    gate_git cat-file -e "$commit:$1" 2>/dev/null && return 0
  done
  return 1
}

# gate_candidate_capture - sets CANDIDATE_TREE and CANDIDATE_COMMIT from HEAD or the head. Called
# in the caller's own shell, so they stay set; returns 1 when HEAD holds no commit.
# shellcheck disable=SC2034  # read by the scripts that source this one
gate_candidate_capture() {
  local rev="${EXPLICIT_HEAD:-HEAD}"
  CANDIDATE_COMMIT="$(gate_git rev-parse --verify --quiet "$rev^{commit}" 2>/dev/null)" || return 1
  CANDIDATE_TREE="$(gate_git rev-parse --verify --quiet "$rev^{tree}" 2>/dev/null)" || return 1
}

# gate_candidate_same_tree <local sha...> - does every pushed sha hold CANDIDATE_TREE? Prints the refusal, naming each tree that is not, and returns 1 otherwise:
# one pass cannot speak for several trees.
gate_candidate_same_tree() {
  local sha tree others=""
  for sha in "$@"; do
    tree="$(gate_git rev-parse --verify --quiet "$sha^{tree}" 2>/dev/null)" ||
      { echo "local-sha-unknown: $sha"; return 1; }
    [ "$tree" = "$CANDIDATE_TREE" ] || others="$others $sha=$tree"
  done
  [ -z "$others" ] && return 0
  echo "several-trees: candidate $CANDIDATE_TREE, pushed$others"
  return 1
}

# gate_candidate_read_refs - reads pre-push lines (`<local ref> <local sha> <remote
# ref> <remote sha>`) from stdin and prints one fact per ref: `local <sha>` and then
# `base <commit>`, `zero <remote ref>` or `unfetched <sha>`; `malformed <ref>` for a
# line that is not that. A deleted ref offers no tree, so it prints nothing.
gate_candidate_read_refs() {
  local ref local_sha remote_ref remote_sha commit hex='^[0-9a-f]{40}([0-9a-f]{24})?$'
  while IFS=' ' read -r ref local_sha remote_ref remote_sha || [ -n "$ref" ]; do
    remote_sha="${remote_sha%$'\r'}"
    if ! [[ $local_sha =~ $hex ]] || ! [[ $remote_sha =~ $hex ]]; then
      echo "malformed $ref"
    elif ! [[ $local_sha =~ ^0+$ ]]; then
      echo "local $local_sha"
      if [[ $remote_sha =~ ^0+$ ]]; then
        echo "zero $remote_ref"
      elif commit="$(gate_git rev-parse --verify --quiet "$remote_sha^{commit}" 2>/dev/null)"; then
        echo "base $commit"
      else
        echo "unfetched $remote_sha"
      fi
    fi
  done
}
