#!/usr/bin/env bash
# Lands the current feature branch on the base branch — the one home of the
# mechanical merge (phases/merge.md, spec 042). The squash, or the epic's
# fixup fold, has already run: this rewrites no history.
#
# In order: HEAD is a branch other than the base, and the tree is clean;
# `origin/<base>` is fetched and the branch contains it; the base is checked
# out and fast-forwarded to the branch; the base is pushed with an explicit
# refspec and never its tags; the merged branch is deleted with `-d`; HEAD is
# verified to be the base. The base is base-branch.sh's, never an argument.
# Under `merge: manual` the landing hook holds this script like a `git push`
# (merge-commands.txt) — the script does not read the mode itself.
#
# Prints `LANDED <base> <first>..<last> <n> commit(s)` on success.
#
# Exit: 0 landed and pushed · 2 usage, or not on a feature branch · 3 base
# unknown · 4 the tree is dirty · 5 behind origin/<base> (rebase, re-gate,
# land again) · 6 not a fast-forward · 7 the push was rejected (the merge
# stays on the local base; nothing is retried, never forced) · 8 the branch
# would not delete with -d · 9 HEAD is not the base afterwards.
#
# Usage: land-feature.sh
set -euo pipefail
export GIT_OPTIONAL_LOCKS=0
here=${BASH_SOURCE[0]%/*}

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

git fetch --quiet origin "refs/heads/$base:refs/remotes/origin/$base"
if ! git merge-base --is-ancestor "refs/remotes/origin/$base" HEAD; then
  echo "land-feature: $branch is behind origin/$base — rebase it, re-run the gates, then land" >&2
  exit 5
fi
first=$(git rev-list --reverse "refs/remotes/origin/$base..HEAD" | head -1)
last=$(git rev-parse HEAD)
count=$(git rev-list --count "refs/remotes/origin/$base..HEAD")

git checkout --quiet "$base"
if ! git merge --quiet --ff-only "refs/heads/$branch"; then
  git checkout --quiet "$branch"
  echo "land-feature: $base cannot fast-forward to $branch" >&2
  exit 6
fi
if ! out=$(git -c push.followTags=false push --quiet --no-follow-tags origin "refs/heads/$base:refs/heads/$base" 2>&1); then
  printf '%s\n' "$out" >&2
  echo "land-feature: the push was rejected — the merge stays on the local $base. git fetch, reconcile, land again; never --force" >&2
  exit 7
fi
if ! git branch --quiet -d "$branch"; then
  echo "land-feature: $branch would not delete with -d — the merge did not land as expected" >&2
  exit 8
fi
now=$(git symbolic-ref --quiet --short HEAD || true)
if [ "$now" != "$base" ]; then
  echo "land-feature: HEAD is on '$now', not $base" >&2
  exit 9
fi
printf 'LANDED %s %s..%s %s commit(s)\n' "$base" "${first:0:12}" "${last:0:12}" "$count"
