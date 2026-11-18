#!/usr/bin/env bash
# Records the checkout this session started on: HEAD and the instruction and
# config files the harness has just loaded, so a later check judges what the
# session loaded rather than what the folder holds by then. The binary does the
# work (`specnaut record-checkout` reads this hook's input on stdin and says
# which sources take a record); this script only calls it.
#
# With no `specnaut` on PATH, or one that resolves into the tree, nothing is
# recorded, and a check that needs the record refuses. Always exits 0 and
# prints nothing on stdout: a SessionStart hook's stdout is added to the
# session's context.
# The PATH rule - tree_top, clean_path, resolve_cmd - from _clean-path.sh beside this file, by its
# path: nothing is looked up before the PATH is cleaned.
lib=${BASH_SOURCE[0]%/*}
[ "$lib" != "${BASH_SOURCE[0]}" ] || lib=.
# shellcheck source-path=SCRIPTDIR source=_clean-path.sh
. "$lib/_clean-path.sh" || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
dir=$(pwd -P)
tree_top "$dir"
top=${top:-$dir}
clean_path
resolve_cmd specnaut || exit 0
"$cmd" record-checkout >/dev/null || true
exit 0
