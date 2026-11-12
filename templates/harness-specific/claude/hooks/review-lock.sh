#!/usr/bin/env bash
# Runs before every tool call. Once a session has started a review of a branch
# it cannot trust (`specnaut review start`), it is under the review lock until it
# ends: only what `specnaut review guard` allows runs. The binary judges (it
# reads this hook's input on stdin, and says what the lock allows); this script
# only finds out, cheaply, whether a lock can hold for this call.
#
# Exit 2 stops the call and shows the session why; 0 lets it run. The locks live
# in `<git dir>/specnaut/review-lock/<session id>.json`. With none there the
# call runs without starting the binary, and so does a call whose input opens
# with a session id that holds none: Claude Code writes `session_id` first, and
# any other input goes to the binary. A lock with no `specnaut` on PATH to judge
# it stops the call.
input=$(cat)
refuse() {
  echo "review-lock: $1" >&2
  exit 2
}
dir=$(cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null && pwd -P) ||
  refuse "cannot enter the project folder"
# Git is asked as the binary asks it: none of the caller's GIT_* variables.
vars=(PATH="$PATH" GIT_CONFIG_NOSYSTEM=1)
[ -n "${HOME+x}" ] && vars+=(HOME="$HOME")
[ -n "${XDG_CONFIG_HOME+x}" ] && vars+=(XDG_CONFIG_HOME="$XDG_CONFIG_HOME")
git_dir=$(cd "$dir" && env -i "${vars[@]}" git rev-parse --absolute-git-dir 2>/dev/null) ||
  exit 0
locks="$git_dir/specnaut/review-lock"
[ -e "$locks" ] || [ -L "$locks" ] || exit 0
id_pattern='^\{"session_id":"([A-Za-z0-9][A-Za-z0-9_-]{0,127})"'
if [ -d "$locks" ] && [ ! -L "$locks" ] && [[ $input =~ $id_pattern ]]; then
  own="$locks/${BASH_REMATCH[1]}.json"
  [ -e "$own" ] || [ -L "$own" ] || exit 0
fi
command -v specnaut >/dev/null 2>&1 ||
  refuse "a review lock is held here and specnaut is not on PATH to judge this call"
cd "$dir" || refuse "cannot enter the project folder"
printf '%s' "$input" | specnaut review guard && exit 0
exit 2
