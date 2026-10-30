#!/usr/bin/env bash
# Lands the current feature branch on the base branch — the one home of the
# mechanical merge (phases/merge.md, spec 042). The squash, or the epic's
# fixup fold, has already run: this rewrites no history.
#
# In order: HEAD is a branch other than the base, and the tree is clean;
# `origin/<base>` is fetched, origin confirms <base> is its default branch,
# and the branch contains it and holds at least one commit origin lacks; the
# base is checked out and fast-forwarded to the branch; the base is pushed
# with an explicit refspec and never its tags; the merged branch is deleted
# with `-d`; HEAD is verified to be the base. The base is base-branch.sh's —
# local-only, so origin is asked here, on the path that already talks to it
# — never an argument. Under `merge: manual` the landing hook holds this
# script like a `git push` (merge-commands.txt): it does not read the mode.
#
# Prints `LANDED <base> <first>..<last> <n> commit(s)` once the push landed.
#
# Exit — the full table; phases/merge.md maps each one:
#   0  landed and pushed
#   2  usage, or not on a feature branch
#   3  base unknown, or origin does not confirm it: the fetch failed, or
#      `ls-remote --symref origin HEAD` failed or names anything but
#      exactly refs/heads/<base>
#   4  the tree is dirty
#   5  behind origin/<base>
#   6  the local <base> has commits origin/<base> lacks — printed as
#      `origin/<base>..<base>`; nothing rebased, nothing pushed
#   7  the push was rejected (the merge stays on the local base; nothing is
#      retried, never forced)
#   9  HEAD is not the base afterwards
#   10 nothing to land: the branch has no commit origin/<base> lacks
#   11 landed and pushed, but the branch would not delete with -d (it stays)
#   12 an unexpected git failure before the push, named on stderr
# (8 is retired: a branch that will not delete after the push is 11, never
# read as a failed landing.)
#
# Usage: land-feature.sh
set -euo pipefail
export GIT_OPTIONAL_LOCKS=0
here=$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# `set -e` alone would exit with git's own code, which no table lists.
trap 'rc=$?; echo "land-feature: unexpected failure (exit $rc) of: $BASH_COMMAND — nothing was pushed" >&2; exit 12' ERR

if [ $# -ne 0 ]; then echo "usage: land-feature.sh" >&2; exit 2; fi
base=$(bash "$here/base-branch.sh") || exit 3
branch=$(git symbolic-ref --quiet --short HEAD) || {
  echo "land-feature: HEAD is detached — check out the feature branch" >&2
  exit 2
}
if [ "$branch" = "$base" ]; then
  echo "land-feature: already on $base — check out the feature branch" >&2
  exit 2
fi
if [ -n "$(git status --porcelain)" ]; then
  git status --short >&2
  echo "land-feature: the tree is dirty — commit, or stop whoever holds it" >&2
  exit 4
fi

if ! GIT_TERMINAL_PROMPT=0 git fetch --quiet origin "refs/heads/$base:refs/remotes/origin/$base"; then
  echo "land-feature: could not fetch $base from origin — offline, or origin has no $base" >&2
  exit 3
fi
# An exact match, never a tail one: `main` must not pass for `refs/heads/team/main`.
if ! answer=$(GIT_TERMINAL_PROMPT=0 git ls-remote --symref origin HEAD); then
  echo "land-feature: origin could not be asked for its default branch (git ls-remote --symref origin HEAD failed)" >&2
  exit 3
fi
default=$(printf '%s\n' "$answer" | awk '$1 == "ref:" && $3 == "HEAD" { print $2; exit }')
if [ "$default" != "refs/heads/$base" ]; then
  [[ $default =~ ^refs/heads/[A-Za-z0-9._/-]+$ ]] || default="<no readable default>"
  echo "land-feature: origin's default branch is $default, not refs/heads/$base — refusing to land. Run: git remote set-head origin --auto" >&2
  exit 3
fi
if ! git merge-base --is-ancestor "refs/remotes/origin/$base" HEAD; then
  echo "land-feature: $branch is behind origin/$base — rebase it, re-run the gates, then land" >&2
  exit 5
fi
count=$(git rev-list --count "refs/remotes/origin/$base..HEAD")
if [ "$count" -eq 0 ]; then
  echo "land-feature: nothing to land — $branch has no commit origin/$base lacks" >&2
  exit 10
fi
# sed, not head: head closing the pipe early would fail rev-list under pipefail.
first=$(git rev-list --reverse "refs/remotes/origin/$base..HEAD" | sed -n 1p)
last=$(git rev-parse HEAD)

git checkout --quiet "$base"
if ! git merge --quiet --ff-only "refs/heads/$branch"; then
  git checkout --quiet "$branch"
  echo "land-feature: the local $base has commits origin/$base lacks (origin/$base..$base):" >&2
  git --no-pager log --format='  %h %s' "refs/remotes/origin/$base..refs/heads/$base" >&2
  echo "land-feature: $base cannot fast-forward to $branch. Nothing was rebased or pushed — those commits are someone's work; stop on them" >&2
  exit 6
fi
if ! out=$(git -c push.followTags=false push --quiet --no-follow-tags origin "refs/heads/$base:refs/heads/$base" 2>&1); then
  printf '%s\n' "$out" >&2
  echo "land-feature: the push was rejected — the merge stays on the local $base — never --force; phases/merge.md maps the recovery" >&2
  exit 7
fi
# The push landed: from here on nothing reads as a failed landing.
trap - ERR
deleted=1
git branch --quiet -d "$branch" || deleted=0
now=$(git symbolic-ref --quiet --short HEAD || true)
if [ "$now" != "$base" ]; then
  echo "land-feature: HEAD is on '$now', not $base" >&2
  exit 9
fi
printf 'LANDED %s %s..%s %s commit(s)\n' "$base" "${first:0:12}" "${last:0:12}" "$count"
if [ "$deleted" = 0 ]; then
  echo "land-feature: landed and pushed, but $branch would not delete with -d — the landing stands; the branch stays" >&2
  exit 11
fi
