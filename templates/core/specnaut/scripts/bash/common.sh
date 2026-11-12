#!/usr/bin/env bash
# Common functions and variables for all scripts

# The nearest directory at or above $1 (default: here) holding a `.specnaut`
# this user owns (cli#750). A filesystem or drive root never counts: a marker
# there would claim every directory on the machine.
find_specnaut_root() {
    local dir
    # Absolute, so the walk ends; `--` for a path starting with `-`.
    dir="$(CDPATH="" cd -- "${1:-.}" 2>/dev/null && pwd)" || return 1
    while :; do
        case "$OSTYPE:$dir" in *:/ | msys*:/[A-Za-z] | cygwin*:/cygdrive/[A-Za-z]) return 1 ;; esac
        if _owned_dir "$dir/.specnaut"; then printf '%s\n' "$dir"; return 0; fi
        dir="${dir%/*}"
        dir="${dir:-/}"
    done
}

# A directory this user owns. Git Bash has no POSIX owner to compare (an
# elevated account's files belong to the Administrators group), so there the
# directory alone counts; the PowerShell twin reads the ACL.
_owned_dir() {
    [ -d "$1" ] || return 1
    case "$OSTYPE" in msys* | cygwin*) return 0 ;; esac
    [ -O "$1" ]
}

# The project root: the directory holding `.specnaut` (cli#750), into VAR.
# Installed, it is the project this script is installed in (its own `../..` is
# that `.specnaut`), wherever it runs: a `.specnaut` planted above the working
# directory cannot claim it. Run in place (the templates tree), the nearest
# `.specnaut` above the working directory, then git's top level, then the
# script's own location.
_resolve_repo_root() {
    local _rr_here _rr_found=""
    _rr_here="$(CDPATH="" cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
    if [ "${_rr_here##*/}" = ".specnaut" ]; then
        _rr_found="${_rr_here%/*}"
    elif ! _rr_found=$(find_specnaut_root) && ! _git_probe _rr_found "$PWD" "" rev-parse --show-toplevel; then
        _rr_found="${_rr_here%/*}"
    fi
    printf -v "$1" '%s' "${_rr_found:-/}"
}

# Once per run (cli#754): resolve the root and ask git in the calling shell, so
# every later call reads both, and the probe's "warned" flag, instead of asking
# again. The functions here are called inside `$( … )`, where a flag set by a
# probe is lost on return; each entry path primes first (get_feature_paths, and
# create-new-feature.sh before its own first call).
prime_repo_state() {
    _SPECNAUT_ROOT="" _SPECNAUT_HAS_GIT=""
    _resolve_repo_root _SPECNAUT_ROOT
    if has_git; then _SPECNAUT_HAS_GIT=true; else _SPECNAUT_HAS_GIT=false; fi
}

get_repo_root() {
    local root="${_SPECNAUT_ROOT:-}"
    [ -n "$root" ] || _resolve_repo_root root
    printf '%s\n' "$root"
}

# The current branch: $SPECIFY_FEATURE, else git's answer at the root, else the
# latest feature directory, else `main`. An unborn HEAD is a normal "no"
# (cli#754): HEAD is still a symbolic ref, and the fallbacks answer quietly.
get_current_branch() {
    if [[ -n "${SPECIFY_FEATURE:-}" ]]; then echo "$SPECIFY_FEATURE"; return; fi
    local repo_root branch=""
    repo_root=$(get_repo_root)
    if has_git && _git_probe branch "$repo_root" "symbolic-ref -q HEAD" rev-parse --abbrev-ref HEAD; then
        echo "$branch"
        return
    fi
    _latest_feature_dir "$repo_root/.specnaut/specs" || echo "main"
}

# The name of the latest feature directory under $1: the newest timestamp
# prefix, else the highest number. Nothing, and status 1, when there is none.
_latest_feature_dir() {
    local dir name number latest="" latest_ts="" highest=0
    for dir in "$1"/*; do
        [[ -d "$dir" ]] || continue
        name="${dir##*/}"
        if [[ "$name" =~ ^([0-9]{8}-[0-9]{6})- ]]; then
            # Timestamp-based branch: compare lexicographically
            if [[ "${BASH_REMATCH[1]}" > "$latest_ts" ]]; then latest_ts="${BASH_REMATCH[1]}"; latest=$name; fi
        elif [[ "$name" =~ ^([0-9]{3,})- ]]; then
            number=$((10#${BASH_REMATCH[1]}))
            # A number wins only while no timestamp branch has been found
            if [[ "$number" -gt "$highest" ]]; then highest=$number; [[ -n "$latest_ts" ]] || latest=$name; fi
        fi
    done
    [[ -n "$latest" ]] && printf '%s\n' "$latest"
}

# Whether the root is inside a git work tree, asked of git at the root
# (cli#750): a project nested in a parent repository works on its branches.
has_git() {
    if [ -n "${_SPECNAUT_HAS_GIT:-}" ]; then [ "$_SPECNAUT_HAS_GIT" = true ]; return; fi
    local inside=""
    _git_probe inside "$(get_repo_root)" "" rev-parse --is-inside-work-tree || return 1
    [ "$inside" = true ]
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
        echo "ERROR: Not on a feature branch. Current branch: $(_printable "$raw")" >&2
        echo "Feature branches should be named like: 001-feature-name, 1234-feature-name, or 20260319-143022-feature-name" >&2
        return 1
    fi

    return 0
}

# Text a file or a directory name supplied, safe to print: a control character
# becomes `?` (cli#752), so an ESC a committer wrote reaches no terminal or agent.
_printable() { printf '%s' "${1//[[:cntrl:]]/?}"; }

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
        echo "ERROR: Multiple spec directories found with prefix '$prefix': $(_printable "${matches[*]}")" >&2
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
    prime_repo_state
    local repo_root current_branch has_git_repo="false"
    repo_root=$(get_repo_root)
    current_branch=$(get_current_branch)
    if has_git; then has_git_repo="true"; fi

    # Resolve feature directory.  Priority:
    #   1. SPECIFY_FEATURE_DIRECTORY env var (explicit override)
    #   2. .specnaut/feature.json "feature_directory" key (persisted by /task plan)
    #   3. Branch-name-based prefix lookup (legacy fallback)
    local feature_dir="" feature_dir_source="branch"
    if [[ -n "${SPECIFY_FEATURE_DIRECTORY:-}" ]]; then
        feature_dir_source="env"
        feature_dir=$(normalize_feature_path "$SPECIFY_FEATURE_DIRECTORY")
    elif [[ -f "$repo_root/.specnaut/feature.json" ]]; then
        feature_dir=$(_feature_json_dir "$repo_root/.specnaut/feature.json") || return 1
        [[ -z "$feature_dir" ]] || feature_dir_source="feature.json"
        feature_dir=$(normalize_feature_path "$feature_dir")
    fi
    if [[ "$feature_dir_source" == "branch" ]]; then
        if ! feature_dir=$(find_feature_dir_by_prefix "$repo_root" "$current_branch"); then
            echo "ERROR: Failed to resolve feature directory" >&2
            return 1
        fi
    else
        # Normalize relative paths to absolute under repo root
        is_absolute_path "$feature_dir" || feature_dir="$repo_root/$feature_dir"
    fi

    if [[ "$feature_dir_source" == "feature.json" && "$has_git_repo" == "true" ]] &&
        _feature_json_contradicts_branch "$feature_dir" "$current_branch"; then
        return 1
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

# The git probe, the feature.json reader and template resolution live beside
# this file; sourced here so every caller of `common.sh` keeps them.
_common_dir="$(CDPATH="" cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/_git_probe.sh
source "$_common_dir/_git_probe.sh"
# shellcheck source=SCRIPTDIR/_feature_json.sh
source "$_common_dir/_feature_json.sh"
# shellcheck source=SCRIPTDIR/template-resolution.sh
source "$_common_dir/template-resolution.sh"
unset _common_dir
