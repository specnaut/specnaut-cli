#!/usr/bin/env bash
# Common functions and variables for all scripts

# Find repository root by searching upward for .specify directory
# This is the primary marker for spec-kit projects
find_specify_root() {
    local dir="${1:-$(pwd)}"
    # Normalize to absolute path to prevent infinite loop with relative paths
    # Use -- to handle paths starting with - (e.g., -P, -L)
    dir="$(cd -- "$dir" 2>/dev/null && pwd)" || return 1
    local prev_dir=""
    while true; do
        if [ -d "$dir/.specify" ]; then
            echo "$dir"
            return 0
        fi
        # Stop if we've reached filesystem root or dirname stops changing
        if [ "$dir" = "/" ] || [ "$dir" = "$prev_dir" ]; then
            break
        fi
        prev_dir="$dir"
        dir="$(dirname "$dir")"
    done
    return 1
}

# Get repository root, prioritizing .specify directory over git
# This prevents using a parent git repo when spec-kit is initialized in a subdirectory
get_repo_root() {
    # First, look for .specify directory (spec-kit's own marker)
    local specify_root
    if specify_root=$(find_specify_root); then
        echo "$specify_root"
        return
    fi

    # Fallback to git if no .specify found
    if git rev-parse --show-toplevel >/dev/null 2>&1; then
        git rev-parse --show-toplevel
        return
    fi

    # Final fallback to script location for non-git repos
    local script_dir="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    (cd "$script_dir/../../.." && pwd)
}

# Get current branch, with fallback for non-git repositories
get_current_branch() {
    # First check if SPECIFY_FEATURE environment variable is set
    if [[ -n "${SPECIFY_FEATURE:-}" ]]; then
        echo "$SPECIFY_FEATURE"
        return
    fi

    # Then check git if available at the spec-kit root (not parent)
    local repo_root=$(get_repo_root)
    if has_git; then
        git -C "$repo_root" rev-parse --abbrev-ref HEAD
        return
    fi

    # For non-git repos, try to find the latest feature directory
    local specs_dir="$repo_root/.specnaut/specs"

    if [[ -d "$specs_dir" ]]; then
        local latest_feature=""
        local highest=0
        local latest_timestamp=""

        for dir in "$specs_dir"/*; do
            if [[ -d "$dir" ]]; then
                local dirname=$(basename "$dir")
                if [[ "$dirname" =~ ^([0-9]{8}-[0-9]{6})- ]]; then
                    # Timestamp-based branch: compare lexicographically
                    local ts="${BASH_REMATCH[1]}"
                    if [[ "$ts" > "$latest_timestamp" ]]; then
                        latest_timestamp="$ts"
                        latest_feature=$dirname
                    fi
                elif [[ "$dirname" =~ ^([0-9]{3,})- ]]; then
                    local number=${BASH_REMATCH[1]}
                    number=$((10#$number))
                    if [[ "$number" -gt "$highest" ]]; then
                        highest=$number
                        # Only update if no timestamp branch found yet
                        if [[ -z "$latest_timestamp" ]]; then
                            latest_feature=$dirname
                        fi
                    fi
                fi
            fi
        done

        if [[ -n "$latest_feature" ]]; then
            echo "$latest_feature"
            return
        fi
    fi

    echo "main"  # Final fallback
}

# Check if we have git available at the spec-kit root level
# Returns true only if git is installed and the repo root is inside a git work tree
# Handles both regular repos (.git directory) and worktrees/submodules (.git file)
has_git() {
    # First check if git command is available (before calling get_repo_root which may use git)
    command -v git >/dev/null 2>&1 || return 1
    local repo_root=$(get_repo_root)
    # Check if .git exists (directory or file for worktrees/submodules)
    [ -e "$repo_root/.git" ] || return 1
    # Verify it's actually a valid git work tree
    git -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1
}

# Strip a single optional path segment (e.g. gitflow "feat/004-name" -> "004-name").
# Only when the full name is exactly two slash-free segments; otherwise returns the raw name.
spec_kit_effective_branch_name() {
    local raw="$1"
    if [[ "$raw" =~ ^([^/]+)/([^/]+)$ ]]; then
        printf '%s\n' "${BASH_REMATCH[2]}"
    else
        printf '%s\n' "$raw"
    fi
}

# True when a branch name follows the feature-branch convention: a sequential
# prefix of 3+ digits, or a timestamp prefix, excluding malformed timestamps
# (7-or-8 digit date + 6-digit time with no trailing slug, e.g. "2026031-143022"
# or "20260319-143022").
#
# Extracted so `check_feature_branch` and the resolution cross-check in
# `get_feature_paths` cannot come to disagree about what a feature branch is.
is_feature_branch_name() {
    local branch="$1"
    if [[ "$branch" =~ ^[0-9]{3,}- ]] && [[ ! "$branch" =~ ^[0-9]{7}-[0-9]{6}- ]] && [[ ! "$branch" =~ ^[0-9]{7,8}-[0-9]{6}$ ]]; then
        return 0
    fi
    [[ "$branch" =~ ^[0-9]{8}-[0-9]{6}- ]]
}

check_feature_branch() {
    local raw="$1"
    local has_git_repo="$2"

    # For non-git repos, we can't enforce branch naming but still provide output
    if [[ "$has_git_repo" != "true" ]]; then
        echo "[specify] Warning: Git repository not detected; skipped branch validation" >&2
        return 0
    fi

    local branch
    branch=$(spec_kit_effective_branch_name "$raw")

    if ! is_feature_branch_name "$branch"; then
        echo "ERROR: Not on a feature branch. Current branch: $raw" >&2
        echo "Feature branches should be named like: 001-feature-name, 1234-feature-name, or 20260319-143022-feature-name" >&2
        return 1
    fi

    return 0
}

# Find feature directory by numeric prefix instead of exact branch match
# This allows multiple branches to work on the same spec (e.g., 004-fix-bug, 004-add-feature)
find_feature_dir_by_prefix() {
    local repo_root="$1"
    local branch_name
    branch_name=$(spec_kit_effective_branch_name "$2")
    local specs_dir="$repo_root/.specnaut/specs"

    # Extract prefix from branch (e.g., "004" from "004-whatever" or "20260319-143022" from timestamp branches)
    local prefix=""
    if [[ "$branch_name" =~ ^([0-9]{8}-[0-9]{6})- ]]; then
        prefix="${BASH_REMATCH[1]}"
    elif [[ "$branch_name" =~ ^([0-9]{3,})- ]]; then
        prefix="${BASH_REMATCH[1]}"
    else
        # If branch doesn't have a recognized prefix, fall back to exact match
        echo "$specs_dir/$branch_name"
        return
    fi

    # Search for directories in .specnaut/specs/ that start with this prefix
    local matches=()
    if [[ -d "$specs_dir" ]]; then
        for dir in "$specs_dir"/"$prefix"-*; do
            if [[ -d "$dir" ]]; then
                matches+=("$(basename "$dir")")
            fi
        done
    fi

    # Handle results
    if [[ ${#matches[@]} -eq 0 ]]; then
        # No match found - return the branch name path (will fail later with clear error)
        echo "$specs_dir/$branch_name"
    elif [[ ${#matches[@]} -eq 1 ]]; then
        # Exactly one match - perfect!
        echo "$specs_dir/${matches[0]}"
    else
        # Multiple matches - this shouldn't happen with proper naming convention
        echo "ERROR: Multiple spec directories found with prefix '$prefix': ${matches[*]}" >&2
        echo "Please ensure only one spec directory exists per prefix." >&2
        return 1
    fi
}

# A path is absolute if it starts with `/` — or, under Git Bash on Windows, if
# it names a drive: `C:\Users\...` or `C:/Users/...`.
#
# `.specnaut/feature.json` is written by the `plan` phase, and on Windows the
# path it carries uses the platform's own separator — the PowerShell twin
# resolves it that way, and so does anything calling the platform's path API.
# Read back here, a drive-letter path does not start with `/`, so the
# "normalize relative paths" rule below used to prepend the repo root and
# produce `/repo/C:\Users\...` — a location that exists nowhere, and whose
# `basename` is the whole mangled string rather than the feature's directory
# name. Both the contradiction guard and the template copy read it.
#
# The PowerShell twin never had this: it asks `[System.IO.Path]::IsPathRooted`
# rather than testing for a leading slash by hand.
is_absolute_path() {
    [[ "$1" == /* ]] && return 0
    [[ "$1" =~ ^[A-Za-z]:[\\/] ]]
}

# Backslashes separate components on Windows and `basename` only ever splits on
# `/`. Rewriting them keeps every consumer on one spelling — but ONLY for a
# drive-letter path: on POSIX a backslash is a legal filename character, so
# converting unconditionally would corrupt a directory that contains one.
normalize_feature_path() {
    local _p="$1"
    [[ "$_p" =~ ^[A-Za-z]:[\\/] ]] && _p="${_p//\\//}"
    printf '%s' "$_p"
}

get_feature_paths() {
    local repo_root=$(get_repo_root)
    local current_branch=$(get_current_branch)
    local has_git_repo="false"

    if has_git; then
        has_git_repo="true"
    fi

    # Resolve feature directory.  Priority:
    #   1. SPECIFY_FEATURE_DIRECTORY env var (explicit override)
    #   2. .specnaut/feature.json "feature_directory" key (persisted by /task plan)
    #   3. Branch-name-based prefix lookup (legacy fallback)
    local feature_dir
    local feature_dir_source
    if [[ -n "${SPECIFY_FEATURE_DIRECTORY:-}" ]]; then
        feature_dir_source="env"
        feature_dir=$(normalize_feature_path "$SPECIFY_FEATURE_DIRECTORY")
        # Normalize relative paths to absolute under repo root
        is_absolute_path "$feature_dir" || feature_dir="$repo_root/$feature_dir"
    elif [[ -f "$repo_root/.specnaut/feature.json" ]]; then
        feature_dir_source="feature.json"
        local _fd
        if command -v jq >/dev/null 2>&1; then
            _fd=$(jq_lf -r '.feature_directory // empty' "$repo_root/.specnaut/feature.json" 2>/dev/null)
        elif command -v python3 >/dev/null 2>&1; then
            # Fallback: use Python to parse JSON so pretty-printed/multi-line files work
            _fd=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('feature_directory',''))" "$repo_root/.specnaut/feature.json" 2>/dev/null)
        else
            # Last resort: single-line grep fallback (won't work on multi-line JSON)
            _fd=$(grep -o '"feature_directory"[[:space:]]*:[[:space:]]*"[^"]*"' "$repo_root/.specnaut/feature.json" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/')
        fi
        if [[ -n "$_fd" ]]; then
            feature_dir=$(normalize_feature_path "$_fd")
            # Normalize relative paths to absolute under repo root
            is_absolute_path "$feature_dir" || feature_dir="$repo_root/$feature_dir"
        elif ! feature_dir=$(find_feature_dir_by_prefix "$repo_root" "$current_branch"); then
            echo "ERROR: Failed to resolve feature directory" >&2
            return 1
        else
            feature_dir_source="branch"
        fi
    else
        feature_dir_source="branch"
        if ! feature_dir=$(find_feature_dir_by_prefix "$repo_root" "$current_branch"); then
            echo "ERROR: Failed to resolve feature directory" >&2
            return 1
        fi
    fi

    # A resolution that contradicts the branch is an error, not an output.
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
    if [[ "$feature_dir_source" == "feature.json" && "$has_git_repo" == "true" ]]; then
        local _eff_branch
        _eff_branch=$(spec_kit_effective_branch_name "$current_branch")
        if is_feature_branch_name "$_eff_branch" && [[ "$(basename "$feature_dir")" != "$_eff_branch" ]]; then
            echo "ERROR: .specnaut/feature.json resolves to a different feature than the current branch." >&2
            echo "  current branch:  $_eff_branch" >&2
            echo "  feature.json:    $(basename "$feature_dir")" >&2
            echo "  resolved path:   $feature_dir" >&2
            echo "Refusing to act on a contradiction: writing here would touch the other feature's files." >&2
            echo "Fix .specnaut/feature.json to name the current feature, or set SPECIFY_FEATURE_DIRECTORY to override deliberately." >&2
            return 1
        fi
    fi

    # Use printf '%q' to safely quote values, preventing shell injection
    # via crafted branch names or paths containing special characters
    printf 'REPO_ROOT=%q\n' "$repo_root"
    printf 'CURRENT_BRANCH=%q\n' "$current_branch"
    printf 'HAS_GIT=%q\n' "$has_git_repo"
    printf 'FEATURE_DIR=%q\n' "$feature_dir"
    printf 'FEATURE_SPEC=%q\n' "$feature_dir/plan.md"
    printf 'IMPL_PLAN=%q\n' "$feature_dir/plan.md"
    printf 'TASKS=%q\n' "$feature_dir/tasks.md"
}

# Check if jq is available for safe JSON construction
has_jq() {
    command -v jq >/dev/null 2>&1
}

# jq_lf <jq args…> — jq, for every call in this script family (cli#701). A
# native Windows jq.exe writes stdout in text mode, every \n as \r\n, so a
# value read with `$(jq -r …)` kept a \r: a path that opens nothing, an id the
# tracker does not know, a count `[ -gt ]` refuses. The \r\n is undone only
# when the jq on PATH was measured writing it, once, as this file is sourced —
# exact, never "drop every \r": a \r a value carries itself survives. jq's
# exit status and its trailing newline are kept. Every copy of this helper is
# the same text (tests/scripts/jq_crlf_test.ts).
JQ_CRLF=0
case $(jq -n 1 2>/dev/null; printf .) in *$'\r\n.') JQ_CRLF=1 ;; esac
jq_lf() {
    local _o _rc=0
    _o=$(_r=0; jq "$@" || _r=$?; printf .; exit "$_r") || _rc=$?
    _o=${_o%.}
    if [ "$JQ_CRLF" = 1 ]; then _o=${_o//$'\r\n'/$'\n'}; fi
    printf '%s' "$_o"
    return "$_rc"
}

# Escape a string for safe embedding in a JSON value (fallback when jq is unavailable).
# Handles backslash, double-quote, and JSON-required control character escapes (RFC 8259).
json_escape() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\t'/\\t}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\b'/\\b}"
    s="${s//$'\f'/\\f}"
    # Escape any remaining U+0001-U+001F control characters as \uXXXX.
    # (U+0000/NUL cannot appear in bash strings and is excluded.)
    # LC_ALL=C ensures ${#s} counts bytes and ${s:$i:1} yields single bytes,
    # so multi-byte UTF-8 sequences (first byte >= 0xC0) pass through intact.
    local LC_ALL=C
    local i char code
    for (( i=0; i<${#s}; i++ )); do
        char="${s:$i:1}"
        printf -v code '%d' "'$char" 2>/dev/null || code=256
        if (( code >= 1 && code <= 31 )); then
            printf '\\u%04x' "$code"
        else
            printf '%s' "$char"
        fi
    done
}

check_file() { [[ -f "$1" ]] && echo "  ✓ $2" || echo "  ✗ $2"; }
check_dir() { [[ -d "$1" && -n $(ls -A "$1" 2>/dev/null) ]] && echo "  ✓ $2" || echo "  ✗ $2"; }

# Template resolution lives beside this file; sourced here so every caller of
# `common.sh` keeps `resolve_template`.
# shellcheck source=SCRIPTDIR/template-resolution.sh
source "$(CDPATH="" cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/template-resolution.sh"
