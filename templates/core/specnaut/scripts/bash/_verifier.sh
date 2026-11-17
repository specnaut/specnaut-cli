# shellcheck shell=bash disable=SC2154 # base and the digests: set by the sourcing script
# HEAD's verdict from the verifier, for land-feature.sh - sourced, never run,
# after it set its git alias, under its `set -Eeuo pipefail` and ERR trap;
# `base`, `scripts_digest` and `instructions_digest` are set before the calls.
# Exit 13 is land-feature.sh's: its header says what the code means.

# The verifier, resolved before it runs, into `sn`: `specnaut` on the PATH must be an absolute
# path, and neither its folder nor any link on the way to it may sit in this repository - the PATH
# can name a folder of the tree, where the branch being landed puts a `specnaut` of its own. Each
# link is followed one hop at a time to the physical file; `-ef` compares device and inode, so
# neither case, a drive-letter spelling nor a `<repo>-x` sibling passes for the repository. The
# rule of phases/script-gate.md § Resolving the verifier, which runs before any script of the tree
# is trusted, so the two spell it apart; one test runs both against the same cases.
resolve_specnaut() {
  local p why="" n=0 d a t top
  p=$(command -v specnaut) || p=""
  top=$(git rev-parse --show-toplevel) || top=""
  case $p in /*) ;; "") why="is not on the PATH" ;; *) why="is not an absolute path" ;; esac
  [ -n "$why" ] || [ -n "$top" ] || why="has no repository to be judged outside of"
  while [ -z "$why" ]; do
    if ! d=$(cd -P "${p%/*}/" && pwd); then why="names a folder that cannot be entered"; break; fi
    p="$d/${p##*/}"; a=$d
    while [ "$a" != / ] && ! [ "$a" -ef "$top" ]; do a=${a%/*}; a=${a:-/}; done
    if [ "$a" -ef "$top" ]; then why="is inside the repository"; break; fi
    if ! [ -L "$p" ]; then sn=$p; return 0; fi
    n=$((n + 1)); if [ "$n" -gt 40 ]; then why="links more than 40 times"; break; fi
    if ! t=$(readlink "$p"); then why="is a link that cannot be read"; break; fi
    case $t in /*) p=$t ;; *) p="$d/$t" ;; esac
  done
  echo "land-feature: VERIFIER REFUSED: ${p:-specnaut} $why - could not judge HEAD, nothing was landed" >&2
  exit 13
}

# HEAD's verdict, from the binary, each digest held passed on as its flag: return 0, or exit 13.
# The binary compares the digests; this reads its lines. The instructions must be trusted or held
# by their digest; the scripts, when a digest was passed, too. Without one the scripts' verdict is
# merge step 0's, which stops before the landing, and a local base ahead of origin stays exit 6's.
judge_head() {
  local out rc=0 names ok=1 flags=()
  [ -z "$scripts_digest" ] || flags+=(--approved-scripts "$scripts_digest")
  [ -z "$instructions_digest" ] || flags+=(--approved-instructions "$instructions_digest")
  out=$("$sn" verify-scripts ${flags[@]+"${flags[@]}"}) || rc=$?
  names=$(sed -n 's/^NAMES_FILE //p' <<<"$out")
  [ -z "$names" ] || rm -f "$names"
  if [ "$rc" -gt 1 ] || ! grep -qE '^INSTRUCTIONS_DIGEST [0-9a-f]{64}$' <<<"$out" ||
    ! grep -qxF "BASE_BRANCH $base" <<<"$out"; then
    echo "land-feature: the verifier could not judge HEAD (exit $rc) - nothing was landed" >&2
    exit 13
  fi
  [ -z "$scripts_digest" ] || [ "$(sed -n '$p' <<<"$out")" = "VERDICT scripts trusted" ] ||
    grep -q '^APPROVAL scripts holds ' <<<"$out" || ok=0
  grep -qx 'VERDICT instructions trusted' <<<"$out" ||
    { [ -n "$instructions_digest" ] && grep -q '^APPROVAL instructions holds ' <<<"$out"; } || ok=0
  [ "$ok" = 0 ] || return 0
  grep -E '^(VERDICT instructions |UNTRUSTED |APPROVAL )' <<<"$out" >&2 || true
  echo "land-feature: HEAD's instructions, or its helper scripts under --scripts-digest, are neither trusted nor the digest passed - ask, then land again with it. Nothing was landed" >&2
  exit 13
}
