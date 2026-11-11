# shellcheck shell=bash disable=SC2154 # here: set by the sourcing script
# The base and its refs, resolved once for wip-audit.sh and its intake gate
# (cli#760) — the one home of `unread`, `present` and the published ref.
# Sourced, never run, by wip-audit.sh, which sets `here` (this directory) and
# `set -euo pipefail`. base-branch.sh beside it names the base.
#
# resolve_base_refs sets four names, every ref fully qualified so a tag named
# like the base cannot shadow it:
#   base       the base branch's name, from base-branch.sh (unknown: exit 3)
#   remote     refs/remotes/origin/<base>, or "" when it does not exist
#   local      refs/heads/<base>, or "" when it does not exist
#   published  remote, else local; neither resolving is exit 3
#
# A read that fails is never taken for one that found nothing: git's own
# errors are discarded (they can carry ref text) and the script stops, 3.

# unread <what> — a git read failed: exit 3, never a conclusion drawn from no output.
unread() { echo "wip-audit: could not read $1 — nothing classified" >&2; exit 3; }
# present <ref> — 0 it exists, 1 it does not; any other git failure is unread.
present() {
  local s=0
  git --no-pager show-ref --verify --quiet "$1" || s=$?
  [ "$s" -le 1 ] || unread "$1"
  return "$s"
}
resolve_base_refs() {
  base=$(bash "$here/base-branch.sh") || exit 3
  remote="refs/remotes/origin/$base" local="refs/heads/$base"
  present "$remote" || remote=""
  present "$local" || local=""
  published=${remote:-$local}
  [ -n "$published" ] || { echo "wip-audit: the base '$base' does not resolve to a commit" >&2; exit 3; }
}
