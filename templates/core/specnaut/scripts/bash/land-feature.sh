#!/usr/bin/env bash
# Lands the current feature branch on the base branch — the one home of the
# mechanical merge (phases/merge.md, spec 042). The squash, or the epic's
# fixup fold, has already run: this rewrites no history.
#
# In order: HEAD is a branch other than the base, and the tree is clean;
# `origin/<base>` is fetched, origin confirms <base> is its default branch,
# and the branch contains it and holds at least one commit origin lacks; HEAD
# is judged; after a yes that held, the approvals of the customised shipped
# skills it covered are committed on top of HEAD (record_approvals in
# _verifier.sh: `APPROVALS NOT RECORDED` when the binary cannot); HEAD's
# git-lfs objects are pushed (lfs-push.sh); the base is checked out and
# fast-forwarded to the branch, or to that commit; the base is pushed with an
# explicit refspec and never its tags; the merged branch is deleted with `-d`;
# HEAD is verified to be the base. No git hook runs at any step. The base is
# base-branch.sh's — local-only, so origin is asked here, on the path that
# already talks to it — never an argument. Reaching it is the instruction to
# land: it reads no mode.
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
#   13 HEAD's instructions or helper scripts are neither trusted nor the
#      digest passed, as the verifier judges them (without --scripts-digest
#      only a local base ahead of origin passes, to exit 6); or it could not
#      judge HEAD, or `specnaut` resolved to a path it refuses, or the PATH
#      holds an empty, relative or in-repository entry (VERIFIER REFUSED,
#      naming it), or the yes no longer held when its approvals were
#      recorded; its VERDICT instructions, UNTRUSTED and APPROVAL lines are
#      printed. Nothing moved
#   17 HEAD's git-lfs objects could not be pushed first (lfs-push.sh: its LFS
#      line names why). Nothing moved; the git push never ran
# (8 is retired: a branch that will not delete after the push is 11, never
# read as a failed landing.)
#
# HEAD is judged here, not taken from the phase: a stop the phase skipped is
# still a stop. `--scripts-digest` and `--instructions-digest` are the
# SCRIPTS_DIGEST and INSTRUCTIONS_DIGEST the user said yes to
# (phases/script-gate.md); each is passed on to the verifier as
# --approved-scripts / --approved-instructions, which compares it. Its limit:
# when the scripts are the branch's, this script is too, judged by its own
# approved bytes; the merge phase's own step-0 call is the binding.
#
# Usage: land-feature.sh [--scripts-digest <sha256>] [--instructions-digest <sha256>]
# -E: the ERR trap _hooks_off.sh sets reaches functions and command substitutions too, so a failure
# there is exit 12, never the raw code of the command that failed.
set -Eeuo pipefail
export GIT_OPTIONAL_LOCKS=0
# This script's folder, read with builtins: the PATH is judged before any command it names runs.
here=${BASH_SOURCE[0]}
# Git Bash runs a script by its Windows path too (C:\...\bash\<name>.sh): cut at the last `/` or `\`.
case $here in *[/\\]*) here=${here%[/\\]*} ;; *) here=. ;; esac
here=$(CDPATH="" cd "${here:-/}" && pwd)
# Every git call runs no hook, and an unexpected failure is exit 12: _hooks_off.sh says why.
# shellcheck source=./_hooks_off.sh
. "$here/_hooks_off.sh" land-feature
# shellcheck source=./_verifier.sh
. "$here/_verifier.sh"
# Before the first command looked up on the PATH: `bash` below is one.
refuse_unsafe_path landed

usage="usage: land-feature.sh [--scripts-digest <sha256>] [--instructions-digest <sha256>]"
scripts_digest=""
instructions_digest=""
while [ $# -gt 0 ]; do
  if [ $# -lt 2 ] || ! [[ $2 =~ ^[0-9a-f]{64}$ ]]; then
    echo "$usage" >&2
    exit 2
  fi
  case $1 in
    --scripts-digest) [ -z "$scripts_digest" ] && scripts_digest=$2 ;;
    --instructions-digest) [ -z "$instructions_digest" ] && instructions_digest=$2 ;;
    *) false ;;
  esac || {
    echo "$usage" >&2
    exit 2
  }
  shift 2
done
base=$(bash "$here/base-branch.sh") || exit 3
branch=$(git symbolic-ref --quiet --short HEAD) || {
  echo "land-feature: HEAD is detached — check out the feature branch" >&2
  exit 2
}
if [ "$branch" = "$base" ]; then
  echo "land-feature: already on $base — check out the feature branch" >&2
  exit 2
fi
# Captured first: a status that fails is the ERR trap's 12, never a clean tree.
dirty=$(git status --porcelain)
if [ -n "$dirty" ]; then
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
  echo "land-feature: origin's default branch is $default, not refs/heads/$base - refusing to land. Run: git -c core.hooksPath=/dev/null remote set-head origin --auto" >&2
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
resolve_specnaut
judge_head
record_approvals
# The judged commit's git-lfs objects first, while nothing has moved: the push below runs no hook,
# so git-lfs's pre-push upload never does. Its 17 is its own refusal; anything else is 12.
rc=0
bash "$here/lfs-push.sh" "$last" >&2 || rc=$?
case $rc in
  0) ;;
  17) exit 17 ;;
  *)
    echo "land-feature: lfs-push.sh failed (exit $rc) - nothing was pushed" >&2
    exit 12
    ;;
esac

git checkout --quiet "$base"
# The commit judged above, or the approvals commit on it, never the branch's name: a ref that moved
# since would land unjudged. A base that already contained it and more stays where it is: it holds
# commits origin lacks.
if ! git merge --quiet --ff-only "$land" || [ "$(git rev-parse HEAD)" != "$land" ]; then
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
[ "$land" = "$last" ] || count=$((count + 1))
printf 'LANDED %s %s..%s %s commit(s)\n' "$base" "${first:0:12}" "${land:0:12}" "$count"
if [ "$deleted" = 0 ]; then
  echo "land-feature: landed and pushed, but $branch would not delete with -d — the landing stands; the branch stays" >&2
  exit 11
fi
