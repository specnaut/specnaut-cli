#!/usr/bin/env bash
# Records the checkout this session started on: HEAD and the instruction and
# config files the harness has just loaded, so a later check judges what the
# session loaded rather than what the folder holds by then. The binary does the
# work (`specnaut record-checkout` reads this hook's input on stdin and says
# which sources take a record); this script only calls it.
#
# With no `specnaut` on PATH nothing is recorded, and a check that needs the
# record refuses. Always exits 0 and prints nothing on stdout: a SessionStart
# hook's stdout is added to the session's context.
command -v specnaut >/dev/null 2>&1 || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
specnaut record-checkout >/dev/null || true
exit 0
