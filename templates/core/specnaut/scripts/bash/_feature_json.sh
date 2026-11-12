#!/usr/bin/env bash
# What `.specnaut/feature.json` names, and whether that contradicts the branch.
# Sourced by `common.sh`, whose `get_feature_paths` is the one caller.

# The "feature_directory" of the feature.json at $1: by jq, else python3, else a
# single-line grep (which misses a pretty-printed file).
_feature_json_dir() {
    if command -v jq >/dev/null 2>&1; then
        jq_lf -r '.feature_directory // empty' "$1" 2>/dev/null
    elif command -v python3 >/dev/null 2>&1; then
        python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('feature_directory',''))" "$1" 2>/dev/null
    else
        grep -o '"feature_directory"[[:space:]]*:[[:space:]]*"[^"]*"' "$1" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/'
    fi
}

# A resolution that contradicts the branch is an error, not an output: status 0,
# and the refusal on stderr, when the feature.json directory $1 names another
# feature than the branch $2.
#
# `.specnaut/feature.json` is written by the `plan` phase and names the
# feature it was writing at the time. Anything that resolves paths before
# the CURRENT feature has been persisted reads the PREVIOUS one — and then
# every caller receives a `CURRENT_BRANCH` and a `FEATURE_DIR` that name
# different features, in the same breath, with nothing comparing them.
# `setup-plan.sh` copied a blank template over the older feature's plan on
# exactly that reading.
#
# Only the `feature.json` rule can contradict the branch: the env override
# is a deliberate instruction to look elsewhere, and the prefix fallback is
# derived from the branch, so neither can disagree with it. The comparison
# is skipped off a feature branch, where `check_feature_branch` already
# reports a better error.
_feature_json_contradicts_branch() {
    local branch
    branch=$(spec_kit_effective_branch_name "$2")
    is_feature_branch_name "$branch" && [[ "$(basename "$1")" != "$branch" ]] || return 1
    echo "ERROR: .specnaut/feature.json resolves to a different feature than the current branch." >&2
    echo "  current branch:  $(_printable "$branch")" >&2
    echo "  feature.json:    $(_printable "$(basename "$1")")" >&2
    echo "  resolved path:   $(_printable "$1")" >&2
    echo "Refusing to act on a contradiction: writing here would touch the other feature's files." >&2
    echo "Fix .specnaut/feature.json to name the current feature, or set SPECIFY_FEATURE_DIRECTORY to override deliberately." >&2
}
