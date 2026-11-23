# shellcheck shell=bash
# _hooks_off.sh <name> - the prologue land-feature.sh and lfs-push.sh share (cli#806). Sourced,
# never run, under the caller's `set -Eeuo pipefail`, and before the rest of the caller: an alias
# applies only to lines bash parses after it is defined, and land-feature.sh, lfs-push.sh and the
# _approvals.sh land-feature.sh sources call git. <name> is the caller's, into `me`: what it, the
# ERR trap and _verifier.sh print starts with it.

# Every git call of the caller runs no hook: the branch being landed could commit hooks and a
# repository-relative core.hooksPath naming them, and the caller fetches, checks out, merges and
# pushes for it. A project's own post-merge or pre-push hooks do not run here either. The value is
# the one the binary's own git wrapper passes on every platform (untrusted_git_flags.ts). An
# alias, not a function: bash 3.2 runs the ERR trap for a `command git` that fails inside an
# `if`, and a function's body escapes the caller's `if` under -E.
shopt -s expand_aliases
alias git='git -c core.hooksPath=/dev/null'
me=$1

# `set -e` alone would exit with git's own code, which no exit table lists: 12 is the unexpected
# failure in each. In a command substitution the trap only passes the code out: the line that ran
# it decides, by its own `||` or by this trap, as it did before -E.
unexpected() {
  [ "$BASH_SUBSHELL" -eq 0 ] || exit "$1"
  echo "$me: unexpected failure (exit $1) of: $2 - nothing was pushed" >&2
  exit 12
}
trap 'unexpected $? "$BASH_COMMAND"' ERR
