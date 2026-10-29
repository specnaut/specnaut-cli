#!/usr/bin/env bash
# The base branch of this repository — its one home (spec 036, plan § 5).
#
# Prints the name on stdout: what origin/HEAD points at (the remote's own
# default), else the configured `init.defaultBranch`. Neither → exit 3,
# unknown. Callers never substitute `main` for unknown: `/specnaut merge`
# stops and asks for the base, and the landing hook gates every landing.
#
# Usage: base-branch.sh
set -euo pipefail
export GIT_OPTIONAL_LOCKS=0

if ref=$(git --no-pager symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null); then
  printf '%s\n' "${ref#origin/}"
  exit 0
fi
if name=$(git --no-pager config --get init.defaultBranch 2>/dev/null) && [ -n "$name" ]; then
  printf '%s\n' "$name"
  exit 0
fi
echo "base-branch: unknown — no origin/HEAD and no init.defaultBranch. Pass the base explicitly, or run: git remote set-head origin --auto" >&2
exit 3
