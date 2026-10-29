#!/usr/bin/env bash
# UserPromptSubmit + Stop — the only writer of the turn approval (spec 036,
# plan § 5, FR-007; D1: minted from the user's prompt, never from a flag the
# model passes). _approval.sh reads it.
#
# On every event the session's stamp is deleted first: an approval never
# outlives its turn — Stop ends it, the next prompt replaces it. A prompt then
# mints one only when the WHOLE prompt (trimmed, lowercased, spaces collapsed,
# a trailing . or ! dropped, an optional leading "yes, ") is one of:
#   merge    /specnaut merge…  $specnaut merge…  merge  merge it  land it  push it
#   release  /ship release…  /ship tag…  $ship release…  $ship tag…  release it  tag it
# Never a bare yes/ok/go: a reply to some other question must not land code.
# A prompt carrying agent_id comes from a subagent, not the user (§ 11
# Measured): nothing is minted or deleted for it.
#
# Not a guard: every failure exits 0 with the reason on stderr. Exit 2 here
# would block the user's prompt, or keep a Claude turn from stopping; failing
# to mint is already the closed outcome.
case ${BASH_SOURCE[0]} in */*) HOOK_DIR=${BASH_SOURCE[0]%/*} ;; *) HOOK_DIR=. ;; esac
# shellcheck source=_guard.sh
. "$HOOK_DIR/_guard.sh" || { echo "specnaut: $HOOK_DIR/_guard.sh is missing" >&2; exit 0; }
# shellcheck source=_approval.sh
. "$HOOK_DIR/_approval.sh"
GUARD_FAIL_CODE=0
guard_init approve-on-prompt "${1:-}" .prompt

# approval_kind_of <prompt> — prints merge, release, or nothing.
approval_kind_of() {
  local p
  p=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -s '[:space:]' ' ')
  p=${p# }
  p=${p% }
  while :; do
    case $p in *. | *!) p=${p%?} ;; *) break ;; esac
  done
  case $p in "yes, "*) p=${p#yes, } ;; esac
  # shellcheck disable=SC2016 # the $ is literal: Codex invokes skills as `$specnaut`
  case $p in
    merge | "merge it" | "land it" | "push it" | "/specnaut merge" | "/specnaut merge "* | '$specnaut merge' | '$specnaut merge '*)
      echo merge ;;
    "release it" | "tag it" | "/ship release" | "/ship release "* | "/ship tag" | "/ship tag "* | '$ship release' | '$ship release '* | '$ship tag' | '$ship tag '*)
      echo release ;;
  esac
}

[ -z "$P_AGENT" ] || exit 0

approval_session_ok "$P_SESSION" || guard_fail "session_id is missing or not a plain token — no approval minted"
stamp=$(approval_path "$P_SESSION")
rm -f "$stamp"

case $P_EVENT in
  Stop) exit 0 ;;
  UserPromptSubmit) ;;
  *) guard_fail "unexpected event '$P_EVENT' — expected UserPromptSubmit or Stop" ;;
esac

kind=$(approval_kind_of "${GF[0]}")
[ -n "$kind" ] || exit 0
if [ "$GUARD_HARNESS" = codex ] && [ -z "$P_TURN" ]; then
  guard_fail "a Codex prompt without turn_id — no approval minted"
fi

dir=${stamp%/*}
mkdir -p "$dir"
chmod 700 "$dir"
tmp=$(mktemp "$dir/.stamp.XXXXXX")
jq -n --arg s "$P_SESSION" --arg t "$P_TURN" --arg k "$kind" \
  '{session_id: $s, turn_id: $t, kind: $k}' >"$tmp"
mv -f "$tmp" "$stamp"
