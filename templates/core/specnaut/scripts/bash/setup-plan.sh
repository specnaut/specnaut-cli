#!/usr/bin/env bash

set -e

# Parse command line arguments
JSON_MODE=false
ARGS=()

for arg in "$@"; do
    case "$arg" in
        --json) 
            JSON_MODE=true 
            ;;
        --help|-h) 
            echo "Usage: $0 [--json]"
            echo "  --json    Output results in JSON format"
            echo "  --help    Show this help message"
            exit 0 
            ;;
        *) 
            ARGS+=("$arg") 
            ;;
    esac
done

# A status line: stdout in text mode; stderr in JSON mode, where stdout is the
# JSON object alone (cli#749). The PowerShell twin prints the same lines.
say() { if $JSON_MODE; then echo "$1" >&2; else echo "$1"; fi; }

# Get script directory and load common functions
SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# Get all paths and variables from common functions: a failure has printed its own one line
_paths_output=$(get_feature_paths) || exit 1
eval "$_paths_output"
unset _paths_output

# Check if we're on a proper feature branch (only for git repos)
check_feature_branch "$CURRENT_BRANCH" "$HAS_GIT" || exit 1

# Ensure the feature directory exists
mkdir -p "$FEATURE_DIR"

# Seed the plan from the template, but NEVER over an existing one.
#
# `create-new-feature.sh` performs the identical copy, from the same template
# to the same filename, and guards it with the same existence check. Only this
# copy was unguarded — so on any feature after the first, a stale
# `feature.json` resolved `$IMPL_PLAN` into the PREVIOUS feature's directory
# and this line replaced a finished plan with a blank template. No backup, no
# confirmation, no way back except git.
#
# The copy is redundant on the happy path anyway: by the time this runs,
# `create-new-feature.sh` has already written the template into the new
# feature's directory. Leaving an existing file alone costs nothing and is the
# only behaviour that cannot destroy work.
if [[ -f "$IMPL_PLAN" ]]; then
    say "Plan already exists at $(_printable "$IMPL_PLAN") - left untouched"
else
    TEMPLATE=$(resolve_template "plan-template" "$REPO_ROOT") || true
    if [[ -n "$TEMPLATE" ]] && [[ -f "$TEMPLATE" ]]; then
        cp "$TEMPLATE" "$IMPL_PLAN"
        say "Copied plan template to $(_printable "$IMPL_PLAN")"
    else
        say "Warning: Plan template not found"
        # Create a basic plan file if template doesn't exist
        touch "$IMPL_PLAN"
    fi
fi

# Output results
if $JSON_MODE; then
    if has_jq; then
        jq_lf -cn \
            --arg feature_spec "$FEATURE_SPEC" \
            --arg impl_plan "$IMPL_PLAN" \
            --arg specs_dir "$FEATURE_DIR" \
            --arg branch "$CURRENT_BRANCH" \
            --arg has_git "$HAS_GIT" \
            '{FEATURE_SPEC:$feature_spec,IMPL_PLAN:$impl_plan,SPECS_DIR:$specs_dir,BRANCH:$branch,HAS_GIT:$has_git}'
    else
        printf '{"FEATURE_SPEC":"%s","IMPL_PLAN":"%s","SPECS_DIR":"%s","BRANCH":"%s","HAS_GIT":"%s"}\n' \
            "$(json_escape "$FEATURE_SPEC")" "$(json_escape "$IMPL_PLAN")" "$(json_escape "$FEATURE_DIR")" "$(json_escape "$CURRENT_BRANCH")" "$(json_escape "$HAS_GIT")"
    fi
else
    # A folder name and the branch read from it are a committer's text: printed
    # with control characters as `?` (cli#752); the JSON above carries them exact.
    echo "FEATURE_SPEC: $(_printable "$FEATURE_SPEC")"
    echo "IMPL_PLAN: $(_printable "$IMPL_PLAN")"
    echo "SPECS_DIR: $(_printable "$FEATURE_DIR")"
    echo "BRANCH: $(_printable "$CURRENT_BRANCH")"
    echo "HAS_GIT: $HAS_GIT"
fi

