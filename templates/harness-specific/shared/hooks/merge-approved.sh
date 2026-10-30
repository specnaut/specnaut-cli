#!/usr/bin/env bash
# Not a hook: no harness registers it (spec 048 § 8). The reader of the
# `merge` approval for the landing scripts — `.specnaut/scripts/bash/
# merge-hold.sh` runs it under `merge: manual`. It lives here, beside the
# hooks, so the stamp's location, its parse and the project root each keep
# one owner (_guard.sh, _approval.sh), and so it sits under SHA256SUMS: on
# Codex a script the model could edit would let it choose where this reads.
#
# Reads no stdin. The session is the id the harness exports to its Bash
# children — CLAUDE_CODE_SESSION_ID, else CODEX_SESSION_ID: Claude's wins when
# both are set. The root is the folder above this file's `.specnaut/hooks/`
# (guard_root), never the caller's cwd.
#
# Exit 0 only when that session's stamp approves `merge` and is under an hour
# old (approved_session). Every other path — no jq, a malformed id, no stamp,
# a crash — exits 2 with one line on stderr naming what releases it.
#
# Usage: merge-approved.sh
case ${BASH_SOURCE[0]} in */*) HOOK_DIR=${BASH_SOURCE[0]%/*} ;; *) HOOK_DIR=. ;; esac
# shellcheck source=_guard.sh
. "$HOOK_DIR/_guard.sh" || { echo "specnaut: $HOOK_DIR/_guard.sh is missing — refusing" >&2; exit 2; }
# shellcheck source=_approval.sh
. "$HOOK_DIR/_approval.sh"
GUARD_NAME=merge-approved

command -v jq >/dev/null 2>&1 \
  || guard_fail "held — jq is not on PATH, so the approval cannot be read: install jq, then run it again"
if [ -n "${CLAUDE_CODE_SESSION_ID:-}" ]; then
  GUARD_HARNESS=claude P_SESSION=$CLAUDE_CODE_SESSION_ID
else
  GUARD_HARNESS=codex P_SESSION=${CODEX_SESSION_ID:-}
fi
# shellcheck disable=SC2034 # read by guard_root outside an installed .specnaut/hooks/
GUARD_CWD=$PWD
approval_session_ok "$P_SESSION" \
  || guard_fail "held — the session id in the environment is not a plain token, so no approval can be its own"

if approved_session merge; then guard_allow; fi
hint=""
if [ "$GUARD_HARNESS" = codex ]; then
  hint=" If you typed merge, the prompt hook did not run — trust the hooks with /hooks."
fi
guard_fail "held — merge: manual, and the user's own prompt this turn did not approve the landing: reply \`merge\` (or \`/task merge\`); a plain \"yes\" does not release it.$hint"
