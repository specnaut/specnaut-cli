# shellcheck shell=bash
# Sourced after _guard.sh. The reader of the turn approval (spec 036, plan § 5,
# FR-007) — approve-on-prompt.sh is its only writer — and the gate every
# gated arm resolves through (FR-017).
#
# The stamp sits OUTSIDE the workspace, under
#   ${XDG_STATE_HOME:-$HOME/.local/state}/specnaut/approvals/<sha256(toplevel)>/<session_id>
# because Codex's workspace-write sandbox refuses the model's writes there
# while hooks, spawned unsandboxed, can write it (§ 11 F3, Measured). It holds
# {session_id, turn_id, kind}. Claude's prompts carry no turn_id: its stamp is
# scoped to the session and deleted by the Stop hook at the end of the turn.

# approval_session_ok <id> — a session id is a path component; only plain tokens.
approval_session_ok() { [[ $1 =~ ^[A-Za-z0-9_-]+$ ]]; }

# approval_sha256 — the hex SHA-256 of stdin: the store key here, and the
# guarded files' fingerprints in _baseline.sh.
approval_sha256() {
  local h
  if command -v sha256sum >/dev/null 2>&1; then h=$(sha256sum)
  elif command -v shasum >/dev/null 2>&1; then h=$(shasum -a 256)
  else guard_fail "neither sha256sum nor shasum is on PATH"; fi
  printf '%s' "${h%% *}"
}

# approval_state <store> <session_id> — where this project keeps that session's
# <store> entry: `approvals` (the stamp) or `baselines` (_baseline.sh).
approval_state() {
  local state hash
  guard_path state "${XDG_STATE_HOME:-}" # a Windows user's C:\… is still theirs
  guard_root
  case $state in /*) ;; *) state="$HOME/.local/state" ;; esac
  hash=$(printf '%s' "$GUARD_ROOT" | approval_sha256)
  printf '%s/specnaut/%s/%s/%s' "$state" "$1" "$hash" "$2"
}

# approval_path <session_id> — where this project's stamp for that session lives.
approval_path() { approval_state approvals "$1"; }

# approved <kind> — the user's own prompt in THIS turn approved <kind>: the
# stamp exists, and its session and kind match; its turn_id must match too
# whenever the payload carries one, which on Codex it always must. Every
# compare is non-empty: an absent id never matches an absent id.
approved() {
  local stamp out
  local -a f
  approval_session_ok "$P_SESSION" || return 1
  if [ "$GUARD_HARNESS" = codex ] && [ -z "$P_TURN" ]; then return 1; fi
  stamp=$(approval_path "$P_SESSION")
  [ -f "$stamp" ] || return 1
  out=$(guard_jq -j '[.session_id, .kind, .turn_id] | map(if type == "string" then gsub("\u001e"; " ") else "" end)
    | join("\u001e") + "\u001e."' "$stamp" 2>/dev/null) || return 1
  IFS=$'\x1e' read -r -a f <<<"$out"
  guard_eq "${f[0]}" "$P_SESSION" || return 1
  guard_eq "${f[1]}" "$1" || return 1
  if [ -n "$P_TURN" ]; then guard_eq "${f[2]}" "$P_TURN" || return 1; fi
  return 0
}

# _approval_ask <reason> — Claude's native permission prompt (exit 0 + "ask").
_approval_ask() {
  jq -cn --arg r "$1" \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: $r}}'
  guard_allow
}

# _approval_can_ask — Claude in a mode whose "ask" reaches the user:
# default/acceptEdits/plan. bypassPermissions/auto/any unknown mode, and
# Codex, whose "ask" fails open, cannot.
_approval_can_ask() {
  [ "$GUARD_HARNESS" = claude ] || return 1
  case $P_MODE in default | acceptEdits | plan) return 0 ;; esac
  return 1
}

# approval_gate <kind> <reason> <what the user types> — resolve a gated arm.
# Where Claude can ask: its permission prompt. Everywhere else: allowed only
# on this turn's approval.
approval_gate() {
  if _approval_can_ask; then _approval_ask "$2"; fi
  if approved "$1"; then guard_allow; fi
  guard_fail "$2. To let it through, reply $3 — a plain \"yes\" does not approve it."
}

# approval_require <kind> <reason> <how the user approves> — stricter than
# approval_gate (spec 038 FR-012): with no approval of <kind> this turn it
# denies even where Claude could ask, because a click on a permission prompt
# is not the user's decision to amend what the project holds itself to. With
# one, Claude asks once more where it can; Codex and bypass mode allow.
approval_require() {
  approved "$1" || guard_fail "$2. $3"
  if _approval_can_ask; then _approval_ask "$2"; fi
  guard_allow
}
