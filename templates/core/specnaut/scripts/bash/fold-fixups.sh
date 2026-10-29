#!/usr/bin/env bash
# Folds an epic branch's `fixup!` commits into their own children, then
# proves nothing else moved (phases/epic-fixups.md, spec 042).
#
# Each fixup was written as `git commit --fixup=<child sha>`, so autosquash
# places it by the sha it names — never by reading a subject. Three checks
# follow, and all must hold:
#   1. the tree did not move   — HEAD's tree is the tree recorded before the fold
#   2. nothing is left behind  — `git status --porcelain` is empty
#   3. one commit per child    — `epic-status.sh` reads the history back, no `fixup!` survives
#
# It prints `PRE <sha>` before it rewrites anything. If the rebase stops on a
# conflict (exit 13), resolve it, `git rebase --continue`, then run
# `fold-fixups.sh --verify <that sha>`: the checks compare against the tree
# recorded before the fold, never against a tree the conflict already moved.
#
# Exit: 0 folded · 2 usage · 3 base unknown · 10 the tree moved · 11 the
# worktree is not clean · 12 not one commit per child · 13 the rebase stopped
# on a conflict · 14 not an epic branch. 12 and 14 are epic-status.sh's own,
# passed through; any other epic-status exit is reported as 3.
#
# Usage: fold-fixups.sh [--verify <pre-sha>]
set -euo pipefail
export GIT_OPTIONAL_LOCKS=0
here=$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

pre=""
case $# in
  0) ;;
  2) [ "$1" = --verify ] && [[ $2 =~ ^[0-9a-f]{7,64}$ ]] || { echo "usage: fold-fixups.sh [--verify <pre-sha>]" >&2; exit 2; }
     pre=$2 ;;
  *) echo "usage: fold-fixups.sh [--verify <pre-sha>]" >&2; exit 2 ;;
esac
base=$(bash "$here/base-branch.sh") || exit 3
range_base=$base
git --no-pager rev-parse --verify --quiet "refs/heads/$base" >/dev/null || range_base="origin/$base"

if [ -n "$(git status --porcelain)" ]; then
  git status --short >&2
  echo "fold-fixups: the worktree is not clean — commit, or stop whoever holds it" >&2
  exit 11
fi

if [ -z "$pre" ]; then
  pre=$(git rev-parse HEAD)
  printf 'PRE %s\n' "$pre"
  # -i: before git 2.44, --autosquash does nothing without it. The editor
  # accepts the todo list as autosquash wrote it; git's stderr is the report.
  if ! GIT_SEQUENCE_EDITOR=true git rebase -i --quiet --autosquash --keep-base "$range_base" >/dev/null; then
    echo "fold-fixups: the rebase stopped on a conflict — resolve it, 'git rebase --continue', then: fold-fixups.sh --verify $pre" >&2
    exit 13
  fi
fi

if ! git --no-pager rev-parse --verify --quiet "$pre^{tree}" >/dev/null; then
  echo "fold-fixups: $pre is not a commit in this repository" >&2
  exit 2
fi
if [ "$(git rev-parse "$pre^{tree}")" != "$(git rev-parse "HEAD^{tree}")" ]; then
  echo "fold-fixups: the tree moved during the fold — this is a rewrite, not a fold" >&2
  exit 10
fi
if [ -n "$(git status --porcelain)" ]; then
  git status --short >&2
  echo "fold-fixups: the worktree is not clean after the fold" >&2
  exit 11
fi
set +e
status=$(bash "$here/epic-status.sh")
rc=$?
set -e
case $rc in
  0) ;;
  12 | 14) exit "$rc" ;;
  *) echo "fold-fixups: epic-status.sh could not read the branch (exit $rc)" >&2; exit 3 ;;
esac
if printf '%s\n' "$status" | grep -q '^FIXUP '; then
  printf '%s\n' "$status" | grep '^FIXUP ' >&2
  echo "fold-fixups: a fixup! survived — its target was rewritten, or it was written by hand" >&2
  exit 12
fi
printf '%s\n' "$status"
echo "fold-fixups: folded — tree unchanged, worktree clean, one commit per child"
