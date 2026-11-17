# shellcheck shell=bash disable=SC2154 # base, approved: set by the sourcing script
# HEAD's verdict from the verifier, for land-feature.sh - sourced, never run,
# after it set `base`, `approved` and its git alias, under its
# `set -Eeuo pipefail` and ERR trap. Exit 13 is land-feature.sh's: its header
# says what the code means.

# HEAD's instructions verdict, from the binary: trusted, or the approved digest, or exit 13.
judge_instructions() {
  local out rc=0 names digest
  out=$(specnaut verify-scripts) || rc=$?
  names=$(sed -n 's/^NAMES_FILE //p' <<<"$out")
  [ -z "$names" ] || rm -f "$names"
  digest=$(sed -n 's/^INSTRUCTIONS_DIGEST \([0-9a-f]\{64\}\)$/\1/p' <<<"$out")
  if [ "$rc" -gt 1 ] || [ -z "$digest" ] || ! grep -qxF "BASE_BRANCH $base" <<<"$out"; then
    echo "land-feature: specnaut verify-scripts could not judge HEAD (exit $rc) - nothing was landed" >&2
    exit 13
  fi
  grep -qx 'VERDICT instructions trusted' <<<"$out" && return 0
  [ "$approved" = "$digest" ] && return 0
  grep '^VERDICT instructions ' <<<"$out" >&2 || true
  echo "land-feature: HEAD changes what the session's harness loads, and no --instructions-digest matches $digest - ask, then land again with it. Nothing was landed" >&2
  exit 13
}
