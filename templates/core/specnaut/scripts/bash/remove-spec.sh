#!/usr/bin/env bash
# Removes a shipped feature's spec directory, in its own commit, pushed
# (phases/merge-close.md, spec 042). Run on the base branch after the merge
# landed and the backlog item closed.
#
# Five conditions, all required, else nothing is touched: HEAD is the base;
# `.specnaut/feature.json` names a `feature_directory`; it exists; it is in
# git history (so the removal is lossless — `git log --all -- <dir>` brings
# it back); and it is the landed feature's directory: relative, no `..`, not
# a link, resolving — every link on the path followed, `.specnaut/specs`
# itself included — directly under this repository's `.specnaut/specs/`, its
# basename the branch that landed (a stale feature.json names another).
# Nothing else may be staged, nor edited under it. Then `git rm -r` of it and
# of feature.json, a check that every staged path is one of those deletions,
# a commit, and a push with an explicit refspec and never its tags. Files
# under it that git does not track (ignored ones included) are in no commit:
# they are listed, quoted, and kept — never deleted. Under `merge: manual`
# the landing hook holds this script (merge-commands.txt).
#
# Exit — the full table; phases/merge-close.md maps each one:
#   0  removed and pushed: nothing is left under the directory
#   2  usage
#   3  the base branch is unknown
#   7  the push was rejected (the commit stays on the local base)
#   22 skipped — the condition that failed is printed, and nothing changed
#   23 something else was staged after the check (the removal undone, the
#      rest left staged, nothing committed)
#   24 the tracked files are removed and pushed, but files git does not
#      track remain under the directory, listed and kept
#
# Usage: remove-spec.sh <landed-branch>   (the feature branch just landed)
set -euo pipefail
export GIT_OPTIONAL_LOCKS=0
here=$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
skip() { echo "remove-spec: skipped — $*" >&2; exit 22; }

if [ $# -ne 1 ] || [[ ! $1 =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  echo "usage: remove-spec.sh <landed-branch>" >&2
  exit 2
fi
landed=$1
base=$(bash "$here/base-branch.sh") || exit 3
root=$(git rev-parse --show-toplevel)
cd "$root"
[ "$(git symbolic-ref --quiet --short HEAD || true)" = "$base" ] || skip "HEAD is not $base"
[ -f .specnaut/feature.json ] || skip "no .specnaut/feature.json"
dir=$(sed -n 's/.*"feature_directory"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' .specnaut/feature.json | head -1)
[ -n "$dir" ] || skip "feature.json names no feature_directory"
dir=${dir%/}
case $dir in
  .specnaut/specs/*) ;;
  *) skip "'$dir' is not under .specnaut/specs/" ;;
esac
name=${dir#.specnaut/specs/}
[[ $name =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || skip "'$dir' is not one feature directory directly under .specnaut/specs/"
[ "$name" = "$landed" ] || skip "'$dir' is not the spec of $landed, the branch that landed — feature.json is stale"
[ ! -L "$dir" ] || skip "'$dir' is a link"
[ -d "$dir" ] || skip "'$dir' does not exist"
# Compared with the physical root, not with `cd -P .specnaut/specs`: a linked
# `.specnaut/specs` resolves both sides to the same place elsewhere.
[ "$(cd -P "$dir" && pwd)" = "$(pwd -P)/.specnaut/specs/$name" ] || skip "'$dir' resolves outside .specnaut/specs/ — a link on its path"
[ -n "$(git log --all --oneline -1 -- "$dir")" ] || skip "'$dir' is in no commit — deleting it would destroy the only copy"

id=$(sed -n 's/.*"linked_issue"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' .specnaut/feature.json | head -1)
# The commit takes the whole index, so it must hold the removal alone: work
# someone else staged is theirs, never swept into this commit or unstaged.
git diff --cached --quiet || skip "the index already holds staged changes — commit or unstage them first"
git diff --quiet -- "$dir" .specnaut/feature.json || skip "'$dir' or feature.json has uncommitted changes"
git ls-files --error-unmatch -- .specnaut/feature.json >/dev/null 2>&1 || skip "feature.json is not tracked"
git rm -r --quiet -- "$dir" .specnaut/feature.json
# -z: a name git would quote (core.quotePath) is still compared as written.
while IFS= read -r -d '' status && IFS= read -r -d '' path; do
  case $status:$path in
    D:"$dir"/* | D:.specnaut/feature.json) ;;
    *)
      # Something staged after the check: restore this script's own paths only.
      git restore --staged --worktree --source=HEAD -- "$dir" .specnaut/feature.json
      echo "remove-spec: the staged change held '$path' — the removal is undone, nothing committed" >&2
      exit 23 ;;
  esac
done < <(git diff --cached --no-renames --name-status -z)
git commit --quiet -m "chore(${id:-spec}): remove the spec directory for the shipped feature"
# No --exclude-standard: an ignored file is in no commit either. -z, then %q,
# so a name with a space or a newline still reads as one path.
left=$(git ls-files -o -z -- "$dir" | while IFS= read -r -d '' p; do printf '  %q\n' "$p"; done)
if ! out=$(git -c push.followTags=false push --quiet --no-follow-tags origin "refs/heads/$base:refs/heads/$base" 2>&1); then
  printf '%s\n' "$out" >&2
  echo "remove-spec: the push was rejected — the commit stays on the local $base" >&2
  [ -z "$left" ] || printf 'remove-spec: kept on disk, in no commit:\n%s\n' "$left" >&2
  exit 7
fi
if [ -n "$left" ]; then
  echo "remove-spec: $dir is out of git and pushed, but these files are in no commit and were kept on disk:" >&2
  printf '%s\n' "$left" >&2
  exit 24
fi
echo "remove-spec: removed $dir — restore with: git log --all -- $dir"
