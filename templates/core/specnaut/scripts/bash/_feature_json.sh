#!/usr/bin/env bash
# What `.specnaut/feature.json` names, and whether that contradicts the branch.
# Sourced by `common.sh`, whose `get_feature_paths` is the one caller.

# The status the python3 reader exits with when it ran and the feature.json
# did not read or parse (EX_DATAERR): any other is python3's own, a launcher's
# included, and not the file's.
_FEATURE_JSON_UNPARSEABLE=65

# The "feature_directory" of the feature.json at $1, by jq, else python3, else a
# single-line grep (which misses a pretty-printed file). Nothing, status 0, when
# it names none: no key, a null, or not an object, as Get-FeatureJsonDirectory
# reads it.
#
# A feature.json that exists is a pointer `plan` wrote, so one that cannot be
# read or parsed is refused (cli#778), status 1, never swapped for a guess from
# the branch: the act `_feature_json_contradicts_branch` refuses. The line is
# Get-FeatureJsonDirectory's, with the .NET type its reader throws for the same
# failure, so both twins print one text; a reader's own message names the file.
# One that is not a regular file is refused before any reader runs (cli#780),
# with the type Get-Content throws on a directory. The grep reader cannot tell
# an unparseable file from one without the key, and falls back to the branch on
# both; it also answers when python3 fails to start, as the Windows Store alias
# does, since only the python3 program's own status says the file is at fault.
_feature_json_dir() {
    local _fj_type=ArgumentException _fj_out _fj_status=0
    if [ ! -f "$1" ]; then
        _fj_type=InvalidOperationException
    elif [ ! -r "$1" ]; then
        _fj_type=UnauthorizedAccessException
    elif command -v jq >/dev/null 2>&1; then
        jq_lf -r 'if type == "object" then .feature_directory // empty else empty end' "$1" 2>/dev/null && return 0
    else
        if command -v python3 >/dev/null 2>&1; then
            _fj_out=$(_feature_json_python "$1") || _fj_status=$?
            [ "$_fj_status" -ne 0 ] || { printf '%s' "$_fj_out"; return 0; }
        fi
        [ "$_fj_status" -eq "$_FEATURE_JSON_UNPARSEABLE" ] || { _feature_json_grep "$1"; return 0; }
    fi
    echo "ERROR: Failed to parse .specnaut/feature.json ($_fj_type)" >&2
    return 1
}

# What `_feature_json_dir` reads with python3; -I keeps a module planted in the
# working directory out of it. UTF-8 bytes and no newline: a Windows python3
# ends a print with \r\n. The value is printed only once all of it is known.
_feature_json_python() {
    python3 -I -c "
import json, sys
try:
    text = open(sys.argv[1], encoding='utf-8-sig').read()
    data = json.loads(text) if text.strip() else None
    value = data.get('feature_directory') if isinstance(data, dict) else None
    out = ('' if value is None or value is False else str(value)).encode('utf-8')
except Exception:
    sys.exit(int(sys.argv[2]))
sys.stdout.buffer.write(out)
" "$1" "$_FEATURE_JSON_UNPARSEABLE" 2>/dev/null
}

# What `_feature_json_dir` reads with grep: the first single-line value.
_feature_json_grep() {
    # No match is "no key"; under pipefail grep's status would say otherwise.
    grep -o '"feature_directory"[[:space:]]*:[[:space:]]*"[^"]*"' "$1" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || :
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
