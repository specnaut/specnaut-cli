#!/usr/bin/env bash
# The base branch of this repository — its one home (spec 036, plan § 5).
#
# Prints the name on stdout: what origin/HEAD points at (the remote's own
# default), else the configured `init.defaultBranch`. Neither → exit 3,
# unknown. Callers never substitute `main` for unknown: `/task merge`
# stops and asks for the base, and the landing hook gates every landing.
#
# Every caller hands the name to git as an argument, so a name git would read
# as an option (`--exec=…` reached `git rebase` and ran a command), or one
# with `..` (a range), is exit 3 too — never printed.
#
# Usage: base-branch.sh
set -euo pipefail
export GIT_OPTIONAL_LOCKS=0

# emit <name> — print it if it is a plain branch name, else exit 3.
emit() {
  if [[ $1 =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] && [[ $1 != *..* ]]; then
    printf '%s\n' "$1"
    exit 0
  fi
  echo "base-branch: '$1' is not a branch name this script hands to git — set origin/HEAD to the real base: git remote set-head origin --auto" >&2
  exit 3
}

if ref=$(git --no-pager symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null); then
  emit "${ref#origin/}"
fi
if name=$(git --no-pager config --get init.defaultBranch 2>/dev/null) && [ -n "$name" ]; then
  emit "$name"
fi
echo "base-branch: unknown — no origin/HEAD and no init.defaultBranch. Pass the base explicitly, or run: git remote set-head origin --auto" >&2
exit 3
