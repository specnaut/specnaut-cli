#!/usr/bin/env bash
# The epic's live branch (cli#731) — the one home of the lookup both
# create-new-feature twins run for an epic and its children.
#
# Prints the local branch whose committed `.specnaut/feature.json` links
# <epic>, or nothing when none does. The link lives at a fixed path and is
# committed on the branch, so this reads git, parses no branch name and
# introduces no state file.
#
# The base, and every branch already merged into it, is never the epic's
# branch: a landing can leave the epic's feature.json on the base, and
# checking the base out as the epic's branch blocks every later slice. The
# base is base-branch.sh's, read both locally and as origin/<base>, so a stale
# local base hides no landing; when neither exists the exclusion cannot run,
# and stderr says so. A branch at a base's tip inherits the base's link
# without making it its own, so it is a candidate only when it is HEAD and the
# working tree's feature.json links the epic: any other branch cut there, or
# HEAD planning another item, may be another item's.
#
# What it prints is ASCII: a Windows console may not be UTF-8, and the PowerShell
# twin relays it.
#
# Exit: 0 found or none · 1 usage, or jq missing (no feature.json could be
# read, and "none" would mint the epic a second branch) · 4 several branches
# link the epic (listed on stderr; picking one would be a guess).
#
# Usage: epic-branch.sh <epic>
set -uo pipefail
# Git Bash rewrites a `<ref>:<path>` argument as a Windows path list before git
# sees it, so `git show` read nothing and every branch looked unlinked.
export GIT_OPTIONAL_LOCKS=0 MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"

SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/common.sh
source "$SCRIPT_DIR/common.sh"

epic="${1:?usage: epic-branch.sh <epic>}"
command -v jq >/dev/null 2>&1 || {
    echo "# the epic branch lookup needs jq, which is not installed - it stops rather than create the epic a second branch" >&2
    exit 1
}

# linked <json> — the issue a feature.json body links, or nothing; non-zero when unreadable.
linked() { printf '%s' "$1" | jq_lf -r '.linked_issue // empty' 2>/dev/null; }

bases=()
if base=$(bash "$SCRIPT_DIR/base-branch.sh" 2>/dev/null); then
    for r in "refs/heads/$base" "refs/remotes/origin/$base"; do
        git rev-parse --verify --quiet "$r^{commit}" >/dev/null && bases+=("$r")
    done
fi
[ "${#bases[@]}" -gt 0 ] ||
    echo "# the base branch is unknown - the epic branch lookup cannot skip it or the branches merged into it" >&2
head=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)
top=$(git rev-parse --show-toplevel 2>/dev/null || true)

found=()
for b in $(git for-each-ref --format='%(refname:short)' refs/heads 2>/dev/null); do
    # A name git would read as an option never reaches it.
    if ! [[ $b =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]]; then
        echo "# warning: branch '$b' has a name git could read as an option - skipped for epic lookup" >&2
        continue
    fi
    [ "${#bases[@]}" -gt 0 ] && [ "$b" = "$base" ] && continue
    sha=$(git rev-parse "refs/heads/$b")
    at_tip=false merged=false
    for r in ${bases[@]+"${bases[@]}"}; do
        [ "$sha" = "$(git rev-parse "$r")" ] && at_tip=true
        git merge-base --is-ancestor "refs/heads/$b" "$r" 2>/dev/null && merged=true
    done
    if [ "$at_tip" = true ] && [ "$b" = "$head" ]; then
        # HEAD at a base's tip: its link is the working tree's, not the base's.
        fj=$(cat "$top/.specnaut/feature.json" 2>/dev/null) || continue
    elif [ "$merged" = true ]; then
        continue
    else
        fj=$(git show "refs/heads/$b:.specnaut/feature.json" 2>/dev/null) || continue
    fi
    if ! li=$(linked "$fj"); then
        echo "# warning: branch '$b' has an unreadable .specnaut/feature.json - skipped for epic lookup" >&2
        continue
    fi
    [ "$li" = "$epic" ] && found+=("$b")
done

if [ "${#found[@]}" -gt 1 ]; then
    echo "# several branches link epic #$epic - not picking one: ${found[*]}" >&2
    exit 4
fi
[ "${#found[@]}" -eq 0 ] || printf '%s\n' "${found[0]}"
exit 0
