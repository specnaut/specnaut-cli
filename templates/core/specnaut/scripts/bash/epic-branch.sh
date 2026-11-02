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
# checking the base out as the epic's branch blocks every later slice. A
# branch at the base's tip inherits the base's link without making it its
# own, so it is a candidate only when it is HEAD — the fresh epic branch the
# user is on; any other branch cut there may be another item's. The base is
# base-branch.sh's, read locally, else as origin/<base>; when it is unknown
# the exclusion cannot run, and stderr says so.
#
# Exit: 0 found or none · 1 usage · 4 several branches link the epic (listed
# on stderr; picking one would be a guess).
#
# Usage: epic-branch.sh <epic>
set -uo pipefail
export GIT_OPTIONAL_LOCKS=0

SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/common.sh
source "$SCRIPT_DIR/common.sh"

epic="${1:?usage: epic-branch.sh <epic>}"

base_ref=""
if base=$(bash "$SCRIPT_DIR/base-branch.sh" 2>/dev/null); then
    for r in "refs/heads/$base" "refs/remotes/origin/$base"; do
        if git rev-parse --verify --quiet "$r^{commit}" >/dev/null; then base_ref=$r; break; fi
    done
fi
if [ -z "$base_ref" ]; then
    echo "# the base branch is unknown — the epic branch lookup cannot skip it or the branches merged into it" >&2
else
    base_tip=$(git rev-parse "$base_ref")
    head=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)
fi

found=()
for b in $(git for-each-ref --format='%(refname:short)' refs/heads 2>/dev/null); do
    # A name git would read as an option never reaches it.
    [[ $b =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] || continue
    if [ -n "$base_ref" ]; then
        [ "refs/heads/$b" = "$base_ref" ] && continue
        # Merged: an ancestor of the base — at its tip, unless it is HEAD.
        if git merge-base --is-ancestor "refs/heads/$b" "$base_ref" 2>/dev/null &&
            { [ "$(git rev-parse "refs/heads/$b")" != "$base_tip" ] || [ "$b" != "$head" ]; }; then
            continue
        fi
    fi
    fj=$(git show "refs/heads/$b:.specnaut/feature.json" 2>/dev/null) || continue
    if ! li=$(printf '%s' "$fj" | jq_lf -r '.linked_issue // empty' 2>/dev/null); then
        echo "# warning: branch '$b' has an unreadable .specnaut/feature.json - skipped for epic lookup" >&2
        continue
    fi
    [ "$li" = "$epic" ] && found+=("$b")
done

if [ "${#found[@]}" -gt 1 ]; then
    echo "# several branches link epic #$epic — not picking one: ${found[*]}" >&2
    exit 4
fi
[ "${#found[@]}" -eq 0 ] || printf '%s\n' "${found[0]}"
exit 0
