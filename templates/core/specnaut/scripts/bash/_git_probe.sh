# shellcheck shell=bash
#
# Sourced by common.sh, beside it: the bash twin's one git probe (cli#754). Its
# rule is Invoke-GitProbe's, in _git_probe.ps1, and the two are held to the same
# scenarios by tests/scripts/git_probe_twins_test.ts. Defines a function, and
# clears one run's state: what prime_repo_state (common.sh) and the probe set
# is never inherited from the environment.
unset _SPECNAUT_ROOT _SPECNAUT_HAS_GIT _SPECNAUT_GIT_WARNED

# _git_probe VAR DIR NORMAL_IF GIT_ARGS... — git's stdout into VAR, status 0,
# when git answered; status 1, VAR untouched, when it did not. A normal "no" is
# quiet: no .git in DIR, or a failure NORMAL_IF (a git command from this script
# family, split on spaces, or empty) explains by exiting 0. A .git that git
# cannot read, or no git to read it with, says so once, because the caller then
# carries on as if there were no repository. The sentence is fixed text: git's
# stderr names paths and config, and this reaches an agent.
#
# VAR, like the "warned" flag, is set in the calling shell. Inside `$( … )` both
# are lost on return, which is why an entry path primes first (prime_repo_state).
_git_probe() {
    local _gp_var="$1" _gp_dir="$2" _gp_normal="$3" _gp_out _gp_rc=0 _gp_problem=""
    shift 3
    if command -v git >/dev/null 2>&1; then
        _gp_out=$(git -C "$_gp_dir" "$@" 2>/dev/null) || _gp_rc=$?
        [ "$_gp_rc" = 0 ] && { printf -v "$_gp_var" '%s' "$_gp_out"; return 0; }
        # shellcheck disable=SC2086 # a fixed git command, split into its words on purpose
        [ -n "$_gp_normal" ] && git -C "$_gp_dir" $_gp_normal >/dev/null 2>&1 && return 1
        case "$_gp_rc" in
            126 | 127) _gp_problem="git could not be started (exit $_gp_rc)" ;;
            *) [ -e "$_gp_dir/.git" ] && _gp_problem="git exited $_gp_rc reading this repository" ;;
        esac
    elif [ -e "$_gp_dir/.git" ]; then
        _gp_problem=".git is present but git is not on PATH"
    fi
    if [ -n "$_gp_problem" ] && [ -z "${_SPECNAUT_GIT_WARNED:-}" ]; then
        _SPECNAUT_GIT_WARNED=1
        echo "WARNING: $_gp_problem; continuing without git" >&2
    fi
    return 1
}
