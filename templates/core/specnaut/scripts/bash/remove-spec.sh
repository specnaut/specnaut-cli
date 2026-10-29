#!/usr/bin/env bash
# Removes a shipped feature's spec directory, in its own commit, pushed
# (phases/merge-close.md, spec 042). Run on the base branch after the merge
# landed and the backlog item closed.
#
# Five conditions, all required, else nothing is touched: HEAD is the base;
# `.specnaut/feature.json` names a `feature_directory`; it exists; it is in
# git history (so the removal is lossless — `git log --all -- <dir>` brings
# it back); and it is a feature directory: relative, no `..`, not a link,
# resolving directly under `.specnaut/specs/`. Then `git rm -r` of it and of
# feature.json, a check that every staged path is one of those deletions,
# a commit, and a push with an explicit refspec and never its tags. Under
# `merge: manual` the landing hook holds this script (merge-commands.txt).
#
# Exit: 0 removed and pushed · 2 usage · 3 base unknown · 22 skipped — the
# condition that failed is printed, and nothing changed · 23 the staged
# change held something else (reset, nothing committed) · 7 the push was
# rejected (the commit stays local).
#
# Usage: remove-spec.sh
set -euo pipefail
export GIT_OPTIONAL_LOCKS=0
here=${BASH_SOURCE[0]%/*}
skip() { echo "remove-spec: skipped — $*" >&2; exit 22; }

if [ $# -ne 0 ]; then echo "usage: remove-spec.sh" >&2; exit 2; fi
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
[ ! -L "$dir" ] || skip "'$dir' is a link"
[ -d "$dir" ] || skip "'$dir' does not exist"
[ "$(cd -P "$dir" && pwd)" = "$(cd -P .specnaut/specs && pwd)/$name" ] || skip "'$dir' resolves outside .specnaut/specs/"
[ -n "$(git log --all --oneline -1 -- "$dir")" ] || skip "'$dir' is in no commit — deleting it would destroy the only copy"

id=$(sed -n 's/.*"linked_issue"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' .specnaut/feature.json | head -1)
git rm -r --quiet -- "$dir" .specnaut/feature.json
while IFS=$'\t' read -r status path; do
  case $status:$path in
    D:"$dir"/* | D:.specnaut/feature.json) ;;
    *) git reset --quiet; echo "remove-spec: the staged change held '$path' — reset, nothing committed" >&2; exit 23 ;;
  esac
done < <(git diff --cached --name-status)
git commit --quiet -m "chore(${id:-spec}): remove the spec directory for the shipped feature"
if ! out=$(git -c push.followTags=false push --quiet --no-follow-tags origin "refs/heads/$base:refs/heads/$base" 2>&1); then
  printf '%s\n' "$out" >&2
  echo "remove-spec: the push was rejected — the commit stays on the local $base" >&2
  exit 7
fi
echo "remove-spec: removed $dir — restore with: git log --all -- $dir"
