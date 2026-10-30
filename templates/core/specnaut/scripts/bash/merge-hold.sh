#!/usr/bin/env bash
# Whether a landing script may run now — the hold `merge: manual` puts on
# land-feature.sh and remove-spec.sh themselves (spec 048), so every spelling
# that reaches the unedited scripts is held, not only the ones the landing
# hook's parser reads.
#
# Positive allow only: the last stdout line is exactly `merge-hold: run` on
# every row that lets the caller run, and nothing else ever prints it. A
# caller runs on that line alone, never on the exit code — a `set -u` abort
# under an EXIT trap exits 0 on bash 3.2:
#   [ "$(bash "$here/merge-hold.sh")" = "merge-hold: run" ] || exit 13
#
# Rows, in order:
#   no CLAUDE_CODE_SESSION_ID and no CODEX_SESSION_ID   run (a person in a
#       terminal, an unhooked harness; a note on stderr when CLAUDECODE or
#       CODEX_SANDBOX* says a harness is there anyway)
#   no .specnaut/hooks/guard-merge.sh                    run (nothing could
#       ever write the approval)
#   guard-merge.sh, but no .specnaut/hooks/merge-approved.sh   held
#   merge-mode.sh --strict prints auto                   run (a failure is manual)
#   otherwise                                            what merge-approved.sh
#       says: run on this session's `merge` stamp, else held
# Held: exit 13, one stderr line naming what releases it.
#
# The key is the session id, never CLAUDECODE: IDE terminals set that too.
#
# Usage: merge-hold.sh
set -euo pipefail
export GIT_OPTIONAL_LOCKS=0

here=$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# The project this script is installed in, as merge-mode.sh finds it.
case $here in
  */.specnaut/scripts/bash) root=${here%/.specnaut/scripts/bash} ;;
  *) if ! root=$(git --no-pager rev-parse --show-toplevel 2>/dev/null); then root=$PWD; fi ;;
esac
hooks=$root/.specnaut/hooks

run() { echo "merge-hold: run"; exit 0; }

if [ -z "${CLAUDE_CODE_SESSION_ID:-}" ] && [ -z "${CODEX_SESSION_ID:-}" ]; then
  if [ -n "${CLAUDECODE:-}" ] || [ -n "$(compgen -v CODEX_SANDBOX || true)" ]; then
    echo "merge-hold: no session id in the environment — not held" >&2
  fi
  run
fi
[ -f "$hooks/guard-merge.sh" ] || run
if [ ! -f "$hooks/merge-approved.sh" ]; then
  echo "merge-hold: held — .specnaut/hooks/merge-approved.sh is missing, so no approval can be read: run \`specnaut upgrade\`" >&2
  exit 13
fi
cd "$root"
mode=$(bash "$here/merge-mode.sh" --strict 2>/dev/null) || mode=manual
[ "$mode" != auto ] || run
# The reader prints the one line that says what releases the hold.
if bash "$hooks/merge-approved.sh" >&2; then run; fi
exit 13
