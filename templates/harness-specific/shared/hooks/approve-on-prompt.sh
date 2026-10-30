#!/usr/bin/env bash
# UserPromptSubmit + Stop — the only writer of the turn approval (spec 036,
# plan § 5, FR-007; D1: minted from the user's prompt, never from a flag the
# model passes). _approval.sh reads it.
#
# On every event the session's stamp is deleted first: an approval never
# outlives its turn — Stop ends it, the next prompt replaces it. A prompt then
# mints one only when the WHOLE prompt (trimmed, lowercased, spaces collapsed,
# a trailing . or ! dropped, an optional leading "yes, ") is one of:
#   merge    /task merge…  /specnaut-task merge…  $specnaut-task merge…  merge  merge it  land it  push it
#   release  /ship release|tag…  /specnaut-ship release|tag…  $specnaut-ship release|tag…  release it  tag it
#   constitution  approve the constitution amendment   (spec 038 S2: the phrase
#   gate-config   approve the gate config change        the constitution verb prints)
# Claude spells the skills /task, /ship; Codex /specnaut-task or $specnaut-task
# (harness_commands.ts). A test holds these spellings to harnessCommands.
# Never a bare yes/ok/go: a reply to some other question must not land code.
# `task` and `ship` are common skill names, so `/task merge…` and
# `/ship release|tag…` mint only when .specnaut/installed.lock lists that
# skill — Specnaut's, not the project's own (cli#702; it bites under bypass
# or auto permission modes). The lock is the provenance every other hook
# reads; the specnaut- spellings are ours.
# A prompt carrying agent_id comes from a subagent, not the user (§ 11
# Measured): nothing is minted or deleted for it.
#
# Each user prompt also fingerprints the project-owned files, and Stop
# compares them (_baseline.sh): a change no approval covered blocks the stop
# with a question. It also keeps the base branch as it resolves and the merge
# mode as the guard reads it (cli#718), so neither repointing origin/HEAD nor
# rewriting a ref can loosen the landing hold after the prompt.
#
# Not a guard: every failure exits 0 with the reason on stderr. Exit 2 here
# would block the user's prompt, or keep a Claude turn from stopping; failing
# to mint is already the closed outcome.
case ${BASH_SOURCE[0]} in */*) HOOK_DIR=${BASH_SOURCE[0]%/*} ;; *) HOOK_DIR=. ;; esac
# shellcheck source=_guard.sh
. "$HOOK_DIR/_guard.sh" || { echo "specnaut: $HOOK_DIR/_guard.sh is missing" >&2; exit 0; }
# shellcheck source=_approval.sh
. "$HOOK_DIR/_approval.sh"
# shellcheck source=_paths.sh
. "$HOOK_DIR/_paths.sh"
# shellcheck source=_baseline.sh
. "$HOOK_DIR/_baseline.sh"
GUARD_FAIL_CODE=0
guard_init approve-on-prompt "${1:-}" .prompt any:.stop_hook_active

# approval_kind_of <prompt> — prints merge, release, constitution, gate-config, or nothing;
# a kind spelled through a bare skill name carries it, as merge:task or release:ship.
approval_kind_of() {
  local p
  p=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -s '[:space:]' ' ')
  p=${p# }
  p=${p% }
  while :; do
    case $p in *. | *!) p=${p%?} ;; *) break ;; esac
  done
  case $p in "yes, "*) p=${p#yes, } ;; esac
  # shellcheck disable=SC2016 # the $ is literal: Codex invokes skills as `$specnaut-task`
  case $p in
    "/task merge" | "/task merge "*) echo merge:task ;;
    "/ship release" | "/ship release "* | "/ship tag" | "/ship tag "*) echo release:ship ;;
    merge | "merge it" | "land it" | "push it" | \
      "/specnaut-task merge" | "/specnaut-task merge "* | \
      '$specnaut-task merge' | '$specnaut-task merge '*)
      echo merge ;;
    "release it" | "tag it" | \
      "/specnaut-ship release" | "/specnaut-ship release "* | "/specnaut-ship tag" | "/specnaut-ship tag "* | \
      '$specnaut-ship release' | '$specnaut-ship release '* | '$specnaut-ship tag' | '$specnaut-ship tag '*)
      echo release ;;
    "approve the constitution amendment") echo constitution ;;
    "approve the gate config change") echo gate-config ;;
  esac
}

# specnaut_skill <name> — the lock lists <name> as a skill Specnaut installed.
# Matched on the entry's suffix, whatever harness folder holds it; CR-tolerant
# for a lock checked out with core.autocrlf.
specnaut_skill() {
  awk -v want="/skills/$1/SKILL.md:" '
    { sub(/\r$/, "") }
    /^  [^ ]/ && length($0) > length(want) && substr($0, length($0) - length(want) + 1) == want { found = 1; exit }
    END { exit !found }
  ' "$GUARD_ROOT/.specnaut/installed.lock" 2>/dev/null
}

[ -z "$P_AGENT" ] || exit 0

approval_session_ok "$P_SESSION" || guard_fail "session_id is missing or not a plain token — no approval minted"
guard_root # here, not in the subshells below: _baseline.sh reads GUARD_ROOT
stamp=$(approval_path "$P_SESSION")
baseline=$(approval_state baselines "$P_SESSION")

case $P_EVENT in
  Stop)
    # What this turn approved is read before the stamp goes; the stamp goes
    # before anything that could fail and leave it outliving the turn.
    kinds=""
    for k in constitution gate-config merge; do if approved "$k"; then kinds+=" $k"; fi; done
    rm -f "$stamp"
    baseline_check "$baseline" "$kinds" "${GF[1]}"
    exit 0 ;;
  UserPromptSubmit) rm -f "$stamp" ;;
  *) rm -f "$stamp"; guard_fail "unexpected event '$P_EVENT' — expected UserPromptSubmit or Stop" ;;
esac
baseline_pin_base || : # before the snapshot, whose merge mode reads every pin; never in the way of the mint
baseline_snapshot "$baseline"

kind=$(approval_kind_of "${GF[0]}")
[ -n "$kind" ] || exit 0
case $kind in
  *:*) specnaut_skill "${kind#*:}" || exit 0; kind=${kind%%:*} ;;
esac
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
