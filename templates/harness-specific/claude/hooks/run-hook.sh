#!/bin/sh
# Starts the hook script $1, given the arguments after it, as settings.json registers every hook it
# runs with bash: `/bin/sh "$CLAUDE_PROJECT_DIR/.claude/hooks/run-hook.sh" "<script>" [args]`.
# Registered as `bash "<script>"`, bash itself would be looked up on the session's PATH as given,
# where an entry inside the repository could supply it before any line of the script ran. /bin/sh
# is the shell the harness runs every hook line with, so naming it adds no path a system may lack;
# bash is found on the PATH the hooks' rule keeps (_clean-path.sh), and resolved as `specnaut` is:
# a link into the tree is refused. /bin/bash would not do: some systems keep bash elsewhere.
#
# This stage runs in /bin/sh, which is not privileged: a bash run as /bin/sh imports exported
# functions, so those named like a builtin this file or the rule may run go first, by `unset`,
# which no function can stand in for there (`[` through `command`, which keeps a refused name from
# ending the shell). The script then starts in bash privileged (`-p`): it reads no BASH_ENV,
# imports no exported function and ignores SHELLOPTS, so nothing of the environment runs before
# its first line. A newer bash ignores BASHOPTS, CDPATH and GLOBIGNORE there too; bash 3.2 still
# honours CDPATH and GLOBIGNORE, which no hook reaches: each `cd` is given an absolute folder or
# `.`, and none expands a file name. It is given the session's PATH back: the review hooks
# clean it themselves, so they can name an entry they drop, and the others run their own commands
# on it as before. With no bash left once the PATH is cleaned, the call is refused (exit 2).
unset -f cd pwd command test echo printf read true false local 2>/dev/null
command unset -f '[' 2>/dev/null || :
refuse() {
  echo "run-hook: $1" >&2
  exit 2
}
lib=${0%/*}
[ "$lib" != "$0" ] || lib=.
[ -f "$lib/_clean-path.sh" ] || refuse "cannot read $lib/_clean-path.sh"
# shellcheck source-path=SCRIPTDIR source=_clean-path.sh
. "$lib/_clean-path.sh"
dir=$(cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null && pwd -P) || refuse "cannot enter the project folder"
tree_top "$dir"
top=${top:-$dir}
given=${PATH-} had=${PATH+yes}
clean_path
if ! resolve_cmd bash; then
  [ -z "$why" ] || refuse "VERIFIER REFUSED: $why"
  [ -z "$dropped" ] ||
    refuse "VERIFIER REFUSED: $dropped - start the session from a shell without that entry"
  refuse "no bash on the PATH"
fi
if [ "$had" = yes ]; then PATH=$given; else unset PATH; fi
exec "$cmd" -p "$@"
