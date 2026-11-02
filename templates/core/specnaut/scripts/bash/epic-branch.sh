#!/usr/bin/env bash
# The epic's live branch (cli#731) — the one home of the lookup both
# create-new-feature twins run for an epic and its children.
#
# Prints the first local branch whose committed `.specnaut/feature.json`
# links <epic>, or nothing when none does; always exit 0. The link lives at a
# fixed path and is committed on the branch, so this reads git, parses no
# branch name and introduces no state file.
#
# The base, and every branch already merged into it, is never the epic's
# branch: a landing can leave the epic's feature.json on the base, and
# checking the base out as the epic's branch blocks every later slice. The
# base is base-branch.sh's; when it is unknown the exclusion cannot run, and
# stderr says so.
#
# Usage: epic-branch.sh <epic>
set -uo pipefail
export GIT_OPTIONAL_LOCKS=0

SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/common.sh
source "$SCRIPT_DIR/common.sh"

epic="${1:?usage: epic-branch.sh <epic>}"

if ! base=$(bash "$SCRIPT_DIR/base-branch.sh" 2>/dev/null); then
    base=""
    echo "# the base branch is unknown — the epic branch lookup cannot skip it or the branches merged into it" >&2
fi

for b in $(git for-each-ref --format='%(refname:short)' refs/heads 2>/dev/null); do
    # A name git would read as an option never reaches it.
    [[ $b =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] || continue
    # An ancestor of the base, the base itself included, is merged.
    if [ -n "$base" ] && git merge-base --is-ancestor "refs/heads/$b" "refs/heads/$base" 2>/dev/null; then
        continue
    fi
    fj=$(git show "refs/heads/$b:.specnaut/feature.json" 2>/dev/null) || continue
    li=$(printf '%s' "$fj" | jq_lf -r '.linked_issue // empty' 2>/dev/null) || continue
    if [ "$li" = "$epic" ]; then
        printf '%s\n' "$b"
        exit 0
    fi
done
exit 0
