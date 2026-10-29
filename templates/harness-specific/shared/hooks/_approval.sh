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

# approval_path <session_id> — where this project's stamp for that session lives.
approval_path() {
  local state=${XDG_STATE_HOME:-} hash
  guard_root
  case $state in /*) ;; *) state="$HOME/.local/state" ;; esac
  if command -v sha256sum >/dev/null 2>&1; then
    hash=$(printf '%s' "$GUARD_ROOT" | sha256sum)
  elif command -v shasum >/dev/null 2>&1; then
    hash=$(printf '%s' "$GUARD_ROOT" | shasum -a 256)
  else
    guard_fail "neither sha256sum nor shasum is on PATH"
  fi
  printf '%s/specnaut/approvals/%s/%s' "$state" "${hash%% *}" "$1"
}

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
  out=$(jq -j '[.session_id, .kind, .turn_id] | map(if type == "string" then gsub("\u001e"; " ") else "" end)
    | join("\u001e") + "\u001e."' "$stamp" 2>/dev/null) || return 1
  IFS=$'\x1e' read -r -a f <<<"$out"
  guard_eq "${f[0]}" "$P_SESSION" || return 1
  guard_eq "${f[1]}" "$1" || return 1
  if [ -n "$P_TURN" ]; then guard_eq "${f[2]}" "$P_TURN" || return 1; fi
  return 0
}

# approval_gate <kind> <reason> <what the user types> — resolve a gated arm.
# Claude in default/acceptEdits/plan: its native permission prompt (exit 0 +
# "ask"). Everywhere else — Claude bypassPermissions/auto/any unknown mode,
# and Codex, whose "ask" fails open — allowed only on this turn's approval.
approval_gate() {
  if [ "$GUARD_HARNESS" = claude ]; then
    case $P_MODE in
      default | acceptEdits | plan)
        jq -cn --arg r "$2" \
          '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: $r}}'
        guard_allow
        ;;
    esac
  fi
  if approved "$1"; then guard_allow; fi
  guard_fail "$2. To let it through, reply $3 — a plain \"yes\" does not approve it."
}
