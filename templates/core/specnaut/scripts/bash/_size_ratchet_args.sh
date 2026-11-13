# shellcheck shell=bash disable=SC2034
# (SC2034: SINCE, SINCE_ID and REPORT are read by size-ratchet.sh.)
# _size_ratchet_args.sh - size-ratchet.sh's command line and the base it names. Sourced, never
# run, by size-ratchet.sh after _explicit_head.sh, and calls that script's git().
#
# size_ratchet_options <args...> - sets SINCE and REPORT, and the head options through
#   explicit_head_option; any other argument is a usage error (exit 3). Given a head, it drops
#   every GIT_* variable the script inherits, as boundary-check.sh does: one a caller exported
#   (GIT_DIR, alternates) names another view of the repository than the one the head is judged
#   in. Staged, they are kept: a commit hook's GIT_INDEX_FILE names the index the commit holds.
# size_ratchet_since_id - resolves --since to a commit id in SINCE_ID, or exits 3.

SINCE="" SINCE_ID="" REPORT=0

usage() { echo "usage: size-ratchet.sh [--since <ref> [--head <sha> [--objects <dir>]]] [--report]" >&2; exit 3; }

size_ratchet_options() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --since) [ -n "${2:-}" ] || usage; SINCE="$2"; shift 2 ;;
      --head | --objects) explicit_head_option "$@" || { echo "size-ratchet: $EXPLICIT_REFUSAL" >&2; usage; }; shift 2 ;;
      --report) REPORT=1; shift ;;
      *) usage ;;
    esac
  done
  # A head is judged against an explicit base.
  if [ -n "$EXPLICIT_HEAD_OPTION" ] && [ -z "$SINCE" ]; then usage; fi
  [ -z "$EXPLICIT_HEAD_OPTION$EXPLICIT_OBJECTS_OPTION" ] || explicit_head_clear_env || {
    echo "size-ratchet: an inherited GIT_* variable cannot be dropped" >&2
    exit 3
  }
}

# The base is resolved before the objects folder is added, from this repository's own objects,
# as gate_candidate_base_commit does: it is where the branch lands, and the folder holds the
# branch's commits, so a base found only there was never this repository's. Its id, not its
# name, is used from then on.
size_ratchet_since_id() {
  [ -n "$SINCE" ] || return 0
  SINCE_ID="$(EXPLICIT_OBJECTS="" git rev-parse --verify -q --end-of-options "$SINCE^{commit}")" &&
    return 0
  echo "size-ratchet: not a commit: $SINCE" >&2
  exit 3
}
