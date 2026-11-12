#!/usr/bin/env bash
# git-read.sh [--head <sha> [--objects <dir>]] <form> <args...> - read a repository
# through the git library with
# hardened defaults (_git_untrusted.sh, beside this file). The phases run their
# git reads here, so no program the repository's configuration names runs.
#
# Forms, each one fixed command line taking data only:
#   names <a> <b>  |  patch <a> <b> [<path>...]  |  log <a>..<b> | <rev> [<n>]
#   show <rev> --stat|--no-patch  |  files [<path>]  |  grep <pattern> <rev> [<path>...]
#   base <rev>  |  manifests <a> <b>
#
# Given --head, every form reads that commit from git's objects (_explicit_head.sh):
# `files` lists its tree, `base` starts from it, and no revision may spell HEAD.
#
# Exit: git's own status for a form that ran; 2 for a refused form or argument;
# 70 when the library is missing.
set -euo pipefail

here=$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
[ -f "$here/_git_untrusted.sh" ] || {
  echo "git-read: $here/_git_untrusted.sh is missing; nothing was read" >&2
  exit 70
}
# shellcheck source=SCRIPTDIR/_git_untrusted.sh
. "$here/_git_untrusted.sh" || exit 70

while [ $# -gt 0 ]; do
  case "$1" in --head | --objects) ;; *) break ;; esac
  explicit_head_option "$@" || { echo "git-read: refused: $EXPLICIT_REFUSAL" >&2; exit 2; }
  shift 2
done
explicit_head_from_options _gu_git ||
  { echo "git-read: refused: --head: $EXPLICIT_REFUSAL" >&2; exit 2; }

form="${1:-}"
[ $# -gt 0 ] && shift
case "$form" in
  names) gu_names "$@" ;;
  patch) gu_patch "$@" ;;
  log) gu_log "$@" ;;
  show) gu_show "$@" ;;
  files) gu_files "$@" ;;
  grep) gu_grep "$@" ;;
  base) gu_base "$@" ;;
  manifests) gu_manifests "$@" ;;
  *)
    echo "usage: git-read.sh [--head <sha> [--objects <dir>]] names|patch|log|show|files|grep|base|manifests <args...>" >&2
    exit 2
    ;;
esac
