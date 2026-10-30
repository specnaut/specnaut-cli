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
# The base is read as `refs/heads/<base>` (else `refs/remotes/origin/<base>`),
# so a tag named like it cannot shadow it.
#
# Exit — the full table; phases/merge.md maps each one:
#   0  consistent
#   2  usage
#   3  base unknown
#   12 inconsistent
#   14 not an epic branch (no `Epic:` trailer at all), and .specnaut/feature.json
#      does not name an epic either
#   15 the history could not be read (a `git log` failed) — nothing concluded
#   16 <base>..HEAD is empty, and .specnaut/feature.json's `linked_issue` is
#      an epic whose own `Epic: #<n>` trailers are already in HEAD's history.
#      The range has landed (a re-run after the base moved), so the CHILD/EPIC
#      lines cannot be read back from it — stop, never squash. A range that
#      holds any commit is read as it stands: the second branch of an epic
#      delivered across several is not a re-run
#
# Usage: epic-status.sh
set -euo pipefail
export GIT_OPTIONAL_LOCKS=0
here=$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

if [ $# -ne 0 ]; then echo "usage: epic-status.sh" >&2; exit 2; fi
# The base has one home, base-branch.sh — never an argument.
base=$(bash "$here/base-branch.sh") || exit 3
if ! git --no-pager rev-parse --verify --quiet "refs/heads/$base^{commit}" >/dev/null &&
  ! git --no-pager rev-parse --verify --quiet "refs/remotes/origin/$base^{commit}" >/dev/null; then
  echo "epic-status: the base '$base' does not resolve to a commit" >&2
  exit 3
fi
# Fully qualified: a tag named like the base would otherwise shadow it.
range="refs/heads/$base..HEAD"
git --no-pager rev-parse --verify --quiet "refs/heads/$base" >/dev/null || range="refs/remotes/origin/$base..HEAD"

# unread <what> — a git read failed: 15, never a conclusion drawn from no output.
unread() {
  echo "epic-status: could not read $1 — git log failed; nothing concluded" >&2
  exit 15
}
# Read whole before the loop: a process substitution's exit is never checked.
log=$(git --no-pager log --reverse --format='%H%x1f%s' "$range") || unread "$range"

problems=() epic="" expected=1 children=0
seen=" " # " #<child>=<sha> " pairs: bash 3.2 (macOS) has no associative arrays
while IFS=$'\x1f' read -r sha subject; do
  [ -n "$sha" ] || continue
  if [[ $subject == "fixup! "* ]]; then
    printf 'FIXUP %s\n' "$sha"
    continue
  fi
  # The trailer is the one field read from the body: an anchored line of digits.
  body=$(git --no-pager log -1 --format=%b "$sha") || unread "${sha:0:12}"
  trailer=$(printf '%s\n' "$body" | sed -n 's/^Epic: #\([0-9][0-9]*\)$/\1/p' | sed -n 1p)
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
done <<<"$log"

if [ -z "$epic" ] && [ "$children" -eq 0 ]; then
  # feature.json names an epic when its linked issue is the one HEAD's own
  # `Epic: #<n>` trailers carry: that history is what an epic branch writes,
  # and nothing else writes it. The file has no epic field, by design (D16).
  fj="$here/../../feature.json"
  issue=""
  # Only an empty range can be a landed one: a commit on it is this branch's own.
  [ -f "$fj" ] && [ -z "$log" ] && issue=$(sed -n 's/.*"linked_issue"[[:space:]]*:[[:space:]]*\([1-9][0-9]*\).*/\1/p' "$fj" | sed -n 1p)
  if [ -n "$issue" ]; then
    # Anchored per line by git itself: #50 never matches a trailer of #501.
    hit=$(git --no-pager log -1 --format=%H -E --grep="^Epic: #$issue\$" HEAD) || unread HEAD
    if [ -n "$hit" ]; then
      echo "epic-status: $range is empty, but .specnaut/feature.json links epic #$issue, whose commits HEAD already holds — the range has landed; the CHILD lines cannot be read back. Stop" >&2
      exit 16
    fi
  fi
  echo "epic-status: no 'Epic:' trailer on $range — not an epic branch" >&2
  exit 14
fi
[ -z "$epic" ] || printf 'EPIC #%s\n' "$epic"
if [ ${#problems[@]} -gt 0 ]; then
  printf 'epic-status: %s\n' "${problems[@]}" >&2
  exit 12
fi
exit 0
