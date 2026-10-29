#!/usr/bin/env bash
# What an epic branch has done — the one reader of the epic commit format
# (phases/epic-commits.md, spec 042).
#
# Reads <base>..HEAD, the base being base-branch.sh's, and prints on stdout:
#   CHILD T<NN> #<child> <sha>   one line per child commit, oldest first
#   FIXUP <sha>                  a `fixup!` commit not yet folded
#   EPIC #<n>                    the epic, from the `Epic: #<n>` trailers
# It checks the history reads back to the board: every other commit's
# subject is `<type>(T<NN>): <subject> (#<child>)`, the ordinals run 1, 2,
# 3… with none missing or twice, no child has two commits, and every commit
# names the same epic. Only digits and hex shas are printed; a problem is
# named by sha and ordinal on stderr, never by echoing commit text.
#
# Exit: 0 consistent · 2 usage · 3 base unknown · 12 inconsistent · 14 not an
# epic branch (no `Epic:` trailer at all).
#
# Usage: epic-status.sh
set -euo pipefail
export GIT_OPTIONAL_LOCKS=0
here=${BASH_SOURCE[0]%/*}

if [ $# -ne 0 ]; then echo "usage: epic-status.sh" >&2; exit 2; fi
# The base has one home, base-branch.sh — never an argument.
base=$(bash "$here/base-branch.sh") || exit 3
if ! git --no-pager rev-parse --verify --quiet "refs/heads/$base^{commit}" >/dev/null &&
  ! git --no-pager rev-parse --verify --quiet "refs/remotes/origin/$base^{commit}" >/dev/null; then
  echo "epic-status: the base '$base' does not resolve to a commit" >&2
  exit 3
fi
range="$base..HEAD"
git --no-pager rev-parse --verify --quiet "refs/heads/$base" >/dev/null || range="origin/$base..HEAD"

problems=() epic="" expected=1 children=0
seen=" " # " #<child>=<sha> " pairs: bash 3.2 (macOS) has no associative arrays
while IFS=$'\x1f' read -r sha subject; do
  [ -n "$sha" ] || continue
  if [[ $subject == "fixup! "* ]]; then
    printf 'FIXUP %s\n' "$sha"
    continue
  fi
  # The trailer is the one field read from the body: an anchored line of digits.
  trailer=$(git --no-pager log -1 --format=%b "$sha" | sed -n 's/^Epic: #\([0-9][0-9]*\)$/\1/p' | head -1)
  if [ -z "$trailer" ]; then
    problems+=("${sha:0:12} has no 'Epic: #<n>' trailer")
  elif [ -z "$epic" ]; then
    epic=$trailer
  elif [ "$trailer" != "$epic" ]; then
    problems+=("${sha:0:12} names epic #$trailer, the branch is #$epic")
  fi
  if [[ $subject =~ ^[a-z]+\(T([0-9]{1,4})\):\ .+\ \(#([1-9][0-9]{0,9})\)$ ]]; then
    ordinal=$((10#${BASH_REMATCH[1]}))
    child=${BASH_REMATCH[2]}
    if [ "$ordinal" -ne "$expected" ]; then
      problems+=("${sha:0:12} is T$(printf '%02d' "$ordinal"); T$(printf '%02d' "$expected") was expected next")
    fi
    expected=$((ordinal + 1))
    case $seen in
      *" #$child="*)
        first=${seen#*" #$child="}
        problems+=("child #$child has two commits: ${first%% *} and ${sha:0:12}") ;;
    esac
    seen="$seen#$child=${sha:0:12} "
    children=$((children + 1))
    printf 'CHILD T%02d #%s %s\n' "$ordinal" "$child" "$sha"
  else
    problems+=("${sha:0:12}: its subject is not '<type>(T<NN>): <subject> (#<child>)'")
  fi
done < <(git --no-pager log --reverse --format='%H%x1f%s' "$range")

if [ -z "$epic" ] && [ "$children" -eq 0 ]; then
  echo "epic-status: no 'Epic:' trailer on $range — not an epic branch" >&2
  exit 14
fi
[ -z "$epic" ] || printf 'EPIC #%s\n' "$epic"
if [ ${#problems[@]} -gt 0 ]; then
  printf 'epic-status: %s\n' "${problems[@]}" >&2
  exit 12
fi
exit 0
