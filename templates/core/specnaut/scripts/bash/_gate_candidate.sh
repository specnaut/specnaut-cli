# shellcheck shell=bash
# Sourced by run-gate.sh and gate-impact.sh, and the one home of what a candidate
# is: a tree and the commit that holds it. A pass is a statement about one exact
# tree, so a tree that is dirty, or that moved during the run, is refused rather
# than presented as tested.
#
# Requires REPO_ROOT. Every git call goes through gate_git: this runs inside hooks,
# where git has exported GIT_DIR and friends pointing at someone else's view of
# the repository.

GATE_LOCAL_ENV="$(git rev-parse --local-env-vars 2>/dev/null)"

# gate_git <git args...> - git on this repository, with the inherited repository
# variables gone and no filesystem monitor to start.
gate_git() {
  (
    for gate_var in $GATE_LOCAL_ENV; do unset "$gate_var"; done
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

# gate_candidate_check <tree> - is the work tree still exactly <tree>? Prints the
# refusal and returns 1 when it is not. Status is read with the submodule flag
# the change set uses, so neither can see a change the other cannot.
gate_candidate_check() {
  local status head
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

# gate_candidate_merge_base <name> - the merge-base of HEAD and the default branch <name>,
# from the remote's copy when there is one, as that is where the branch will land.
gate_candidate_merge_base() {
  local ref
  for ref in "refs/remotes/origin/$1" "refs/heads/$1"; do
    gate_git rev-parse --verify --quiet "$ref" >/dev/null 2>&1 || continue
    gate_git merge-base HEAD "$ref" 2>/dev/null
    return $?
  done
  return 1
}

# gate_candidate_declares <path> <commit...> - does the work tree hold <path>, a link
# included, or does HEAD or a given commit? One deleted on the branch is a change,
# not a project that never opted in. Outside a repository only the tree is asked.
gate_candidate_declares() {
  local commit
  [ -e "$REPO_ROOT/$1" ] || [ -L "$REPO_ROOT/$1" ] && return 0
  gate_candidate_in_repo || return 1
  for commit in HEAD "${@:2}"; do
    gate_git cat-file -e "$commit:$1" 2>/dev/null && return 0
  done
  return 1
}

# gate_candidate_capture - sets CANDIDATE_TREE and CANDIDATE_COMMIT from HEAD. Called
# in the caller's own shell, so they stay set; returns 1 when HEAD holds no commit.
# shellcheck disable=SC2034  # read by the scripts that source this one
gate_candidate_capture() {
  CANDIDATE_COMMIT="$(gate_git rev-parse --verify --quiet 'HEAD^{commit}' 2>/dev/null)" || return 1
  CANDIDATE_TREE="$(gate_git rev-parse --verify --quiet 'HEAD^{tree}' 2>/dev/null)" || return 1
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
