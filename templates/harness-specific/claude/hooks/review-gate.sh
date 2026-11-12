#!/usr/bin/env bash
# Runs before each shell command. A command that starts a review of a branch
# the session cannot trust (`specnaut review start`) runs only when the
# session's checkout holds, judged against the record this session's start
# took: the binary does the work (`specnaut review gate` reads this hook's
# input on stdin, and says which commands it judges); this script only calls it.
#
# Exit 2 stops the command and shows the session why; 0 lets it run. Input that
# never mentions a review is let through without starting the binary. With no
# `specnaut` on PATH, `specnaut review start` cannot run either, so nothing is
# stopped here. Either way the pass a gated line left is removed first: a pass
# lives only until the next command, whichever it is.
input=$(cat)
drop_pass() {
  local git_dir
  git_dir=$(cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null && git rev-parse --absolute-git-dir 2>/dev/null) || return 0
  rm -f -- "$git_dir/specnaut/review-pass.json"
}
case "$input" in *review*) ;; *) drop_pass; exit 0 ;; esac
command -v specnaut >/dev/null 2>&1 || { drop_pass; exit 0; }
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || {
  echo "review-gate: cannot enter the project folder" >&2
  exit 2
}
printf '%s' "$input" | specnaut review gate && exit 0
exit 2
